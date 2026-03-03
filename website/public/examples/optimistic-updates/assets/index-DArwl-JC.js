(() => {
  const r = document.createElement("link").relList;
  if (r && r.supports && r.supports("modulepreload")) return;
  for (const o of document.querySelectorAll('link[rel="modulepreload"]')) i(o);
  new MutationObserver((o) => {
    for (const s of o)
      if (s.type === "childList")
        for (const c of s.addedNodes)
          c.tagName === "LINK" && c.rel === "modulepreload" && i(c);
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
var He = class extends Error {
    constructor(r, a, i, o, s = !0) {
      super(r),
        (this.source = a),
        (this.sourceId = i),
        (this.context = o),
        (this.recoverable = s),
        (this.name = "DirectiveError");
    }
  },
  me = [];
function St() {
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
var xt = {
  isTracking: !1,
  track() {},
  getDependencies() {
    return new Set();
  },
};
function $t() {
  return me[me.length - 1] ?? xt;
}
function Ce(e) {
  const r = St();
  me.push(r);
  try {
    return { value: e(), deps: r.getDependencies() };
  } finally {
    me.pop();
  }
}
function Ve(e) {
  const r = me.splice(0, me.length);
  try {
    return e();
  } finally {
    me.push(...r);
  }
}
function Be(e) {
  $t().track(e);
}
function Et(e, r = 100) {
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
    validate(c) {
      return ke([...e, c], r, a, i, o, s);
    },
  };
}
function ee(e, r, a, i, o, s) {
  return {
    ...ke(e, r, a, i, o, s),
    default(c) {
      return ee(e, r, c, i, o, s);
    },
    transform(c) {
      return ee(
        [],
        r,
        void 0,
        (u) => {
          const h = i ? i(u) : u;
          return c(h);
        },
        o,
      );
    },
    brand() {
      return ee(e, `Branded<${r}>`, a, i, o, s);
    },
    describe(c) {
      return ee(e, r, a, i, c, s);
    },
    refine(c, u) {
      const h = [...(s ?? []), { predicate: c, message: u }];
      return ee([...e, c], r, a, i, o, h);
    },
    nullable() {
      return ee(
        [(c) => c === null || e.every((u) => u(c))],
        `${r} | null`,
        a,
        i,
        o,
      );
    },
    optional() {
      return ee(
        [(c) => c === void 0 || e.every((u) => u(c))],
        `${r} | undefined`,
        a,
        i,
        o,
      );
    },
  };
}
var ne = {
  string() {
    return ee([(e) => typeof e == "string"], "string");
  },
  number() {
    const e = (r, a, i, o, s) => ({
      ...ee(r, "number", a, i, o, s),
      min(c) {
        return e([...r, (u) => u >= c], a, i, o, s);
      },
      max(c) {
        return e([...r, (u) => u <= c], a, i, o, s);
      },
      default(c) {
        return e(r, c, i, o, s);
      },
      describe(c) {
        return e(r, a, i, c, s);
      },
      refine(c, u) {
        const h = [...(s ?? []), { predicate: c, message: u }];
        return e([...r, c], a, i, o, h);
      },
    });
    return e([(r) => typeof r == "number"]);
  },
  boolean() {
    return ee([(e) => typeof e == "boolean"], "boolean");
  },
  array() {
    const e = (r, a, i, o, s) => {
      const c = ee(r, "array", i, void 0, o),
        u = s ?? { value: -1 };
      return {
        ...c,
        get _lastFailedIndex() {
          return u.value;
        },
        set _lastFailedIndex(h) {
          u.value = h;
        },
        of(h) {
          const p = { value: -1 };
          return e(
            [
              ...r,
              (d) => {
                for (let E = 0; E < d.length; E++) {
                  const T = d[E];
                  if (!h._validators.every((A) => A(T)))
                    return (p.value = E), !1;
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
          return e([...r, (h) => h.length > 0], a, i, o, u);
        },
        maxLength(h) {
          return e([...r, (p) => p.length <= h], a, i, o, u);
        },
        minLength(h) {
          return e([...r, (p) => p.length >= h], a, i, o, u);
        },
        default(h) {
          return e(r, a, h, o, u);
        },
        describe(h) {
          return e(r, a, i, h, u);
        },
      };
    };
    return e([(r) => Array.isArray(r)]);
  },
  object() {
    const e = (r, a, i) => ({
      ...ee(r, "object", a, void 0, i),
      shape(o) {
        return e(
          [
            ...r,
            (s) => {
              for (const [c, u] of Object.entries(o)) {
                const h = s[c],
                  p = u;
                if (p && !p._validators.every((d) => d(h))) return !1;
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
        return e([...r, (s) => o.every((c) => c in s)], a, i);
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
    return ee(
      [(a) => typeof a == "string" && r.has(a)],
      `enum(${e.join("|")})`,
    );
  },
  literal(e) {
    return ee([(r) => r === e], `literal(${String(e)})`);
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
    return ee(
      [(a) => e.some((i) => i._validators.every((o) => o(a)))],
      r.join(" | "),
    );
  },
  record(e) {
    const r = e._typeName ?? "unknown";
    return ee(
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
    return ee(
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
    return ee([(e) => e instanceof Date && !isNaN(e.getTime())], "Date");
  },
  uuid() {
    const e =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return ee([(r) => typeof r == "string" && e.test(r)], "uuid");
  },
  email() {
    const e = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return ee([(r) => typeof r == "string" && e.test(r)], "email");
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
function Ct(e) {
  const { schema: r, onChange: a, onBatch: i } = e;
  Object.keys(r).length;
  let o = e.validate ?? !1,
    s = e.strictKeys ?? !1,
    c = e.redactErrors ?? !1,
    u = new Map(),
    h = new Set(),
    p = new Map(),
    d = new Set(),
    E = 0,
    T = [],
    A = new Set(),
    O = !1,
    D = [],
    b = 100;
  function R(f) {
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
  function z(f) {
    const w = f;
    if (w._typeName) return w._typeName;
    if (R(f)) {
      const S = f._def;
      if (S?.typeName) return S.typeName.replace(/^Zod/, "").toLowerCase();
    }
    return "unknown";
  }
  function q(f) {
    return c ? "[redacted]" : Et(f);
  }
  function m(f, w) {
    if (!o) return;
    const S = r[f];
    if (!S) {
      if (s)
        throw new Error(
          `[Directive] Unknown fact key: "${f}". Key not defined in schema.`,
        );
      console.warn(`[Directive] Unknown fact key: "${f}"`);
      return;
    }
    if (R(S)) {
      const P = S.safeParse(w);
      if (!P.success) {
        const y = w === null ? "null" : Array.isArray(w) ? "array" : typeof w,
          k = q(w),
          t =
            P.error?.message ??
            P.error?.issues?.[0]?.message ??
            "Validation failed",
          n = z(S);
        throw new Error(
          `[Directive] Validation failed for "${f}": expected ${n}, got ${y} ${k}. ${t}`,
        );
      }
      return;
    }
    const M = S,
      N = M._validators;
    if (!N || !Array.isArray(N) || N.length === 0) return;
    const K = M._typeName ?? "unknown";
    for (let P = 0; P < N.length; P++) {
      const y = N[P];
      if (typeof y == "function" && !y(w)) {
        let k = w === null ? "null" : Array.isArray(w) ? "array" : typeof w,
          t = q(w),
          n = "";
        typeof M._lastFailedIndex == "number" &&
          M._lastFailedIndex >= 0 &&
          ((n = ` (element at index ${M._lastFailedIndex} failed)`),
          (M._lastFailedIndex = -1));
        const l = P === 0 ? "" : ` (validator ${P + 1} failed)`;
        throw new Error(
          `[Directive] Validation failed for "${f}": expected ${K}, got ${k} ${t}${l}${n}`,
        );
      }
    }
  }
  function $(f) {
    p.get(f)?.forEach((w) => w());
  }
  function v() {
    d.forEach((f) => f());
  }
  function C(f, w, S) {
    if (O) {
      D.push({ key: f, value: w, prev: S });
      return;
    }
    O = !0;
    try {
      a?.(f, w, S), $(f), v();
      let M = 0;
      while (D.length > 0) {
        if (++M > b)
          throw (
            ((D.length = 0),
            new Error(
              `[Directive] Infinite notification loop detected after ${b} iterations. A listener is repeatedly mutating facts that re-trigger notifications.`,
            ))
          );
        const N = [...D];
        D.length = 0;
        for (const K of N) a?.(K.key, K.value, K.prev), $(K.key);
        v();
      }
    } finally {
      O = !1;
    }
  }
  function I() {
    if (!(E > 0)) {
      if ((i && T.length > 0 && i([...T]), A.size > 0)) {
        O = !0;
        try {
          for (const w of A) $(w);
          v();
          let f = 0;
          while (D.length > 0) {
            if (++f > b)
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
          O = !1;
        }
      }
      (T.length = 0), A.clear();
    }
  }
  const L = {
    get(f) {
      return Be(f), u.get(f);
    },
    has(f) {
      return Be(f), u.has(f);
    },
    set(f, w) {
      m(f, w);
      const S = u.get(f);
      Object.is(S, w) ||
        (u.set(f, w),
        h.add(f),
        E > 0
          ? (T.push({ key: f, value: w, prev: S, type: "set" }), A.add(f))
          : C(f, w, S));
    },
    delete(f) {
      const w = u.get(f);
      u.delete(f),
        h.delete(f),
        E > 0
          ? (T.push({ key: f, value: void 0, prev: w, type: "delete" }),
            A.add(f))
          : C(f, void 0, w);
    },
    batch(f) {
      E++;
      try {
        f();
      } finally {
        E--, I();
      }
    },
    subscribe(f, w) {
      for (const S of f) {
        const M = S;
        p.has(M) || p.set(M, new Set()), p.get(M).add(w);
      }
      return () => {
        for (const S of f) {
          const M = p.get(S);
          M && (M.delete(w), M.size === 0 && p.delete(S));
        }
      };
    },
    subscribeAll(f) {
      return d.add(f), () => d.delete(f);
    },
    toObject() {
      const f = {};
      for (const w of h) u.has(w) && (f[w] = u.get(w));
      return f;
    },
  };
  return (
    (L.registerKeys = (f) => {
      for (const w of Object.keys(f)) ve.has(w) || ((r[w] = f[w]), h.add(w));
    }),
    L
  );
}
var ve = Object.freeze(new Set(["__proto__", "constructor", "prototype"]));
function kt(e, r) {
  const a = () => ({
    get: (i) => Ve(() => e.get(i)),
    has: (i) => Ve(() => e.has(i)),
  });
  return new Proxy(
    {},
    {
      get(i, o) {
        if (o === "$store") return e;
        if (o === "$snapshot") return a;
        if (typeof o != "symbol" && !ve.has(o)) return e.get(o);
      },
      set(i, o, s) {
        return typeof o == "symbol" ||
          o === "$store" ||
          o === "$snapshot" ||
          ve.has(o)
          ? !1
          : (e.set(o, s), !0);
      },
      deleteProperty(i, o) {
        return typeof o == "symbol" ||
          o === "$store" ||
          o === "$snapshot" ||
          ve.has(o)
          ? !1
          : (e.delete(o), !0);
      },
      has(i, o) {
        return o === "$store" || o === "$snapshot"
          ? !0
          : typeof o == "symbol" || ve.has(o)
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
function Rt(e) {
  const r = Ct(e),
    a = kt(r, e.schema);
  return { store: r, facts: a };
}
function It(e, r) {
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
async function xe(e, r, a) {
  let i,
    o = new Promise((s, c) => {
      i = setTimeout(() => c(new Error(a)), r);
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
    const c = typeof o;
    if (c === "string") return JSON.stringify(o);
    if (c === "number" || c === "boolean") return String(o);
    if (c === "function") return '"[function]"';
    if (c === "symbol") return '"[symbol]"';
    if (Array.isArray(o)) {
      if (a.has(o)) return '"[circular]"';
      a.add(o);
      const u = `[${o.map((h) => i(h, s + 1)).join(",")}]`;
      return a.delete(o), u;
    }
    if (c === "object") {
      const u = o;
      if (a.has(u)) return '"[circular]"';
      a.add(u);
      const h = `{${Object.keys(u)
        .sort()
        .map((p) => `${JSON.stringify(p)}:${i(u[p], s + 1)}`)
        .join(",")}}`;
      return a.delete(u), h;
    }
    return '"[unknown]"';
  }
  return i(e, 0);
}
function be(e, r = 50) {
  const a = new Set(["__proto__", "constructor", "prototype"]),
    i = new WeakSet();
  function o(s, c) {
    if (c > r) return !1;
    if (s == null || typeof s != "object") return !0;
    const u = s;
    if (i.has(u)) return !0;
    if ((i.add(u), Array.isArray(u))) {
      for (const h of u) if (!o(h, c + 1)) return i.delete(u), !1;
      return i.delete(u), !0;
    }
    for (const h of Object.keys(u))
      if (a.has(h) || !o(u[h], c + 1)) return i.delete(u), !1;
    return i.delete(u), !0;
  }
  return o(e, 0);
}
function Ot(e) {
  let r = ft(e),
    a = 5381;
  for (let i = 0; i < r.length; i++) a = ((a << 5) + a) ^ r.charCodeAt(i);
  return (a >>> 0).toString(16);
}
function Dt(e, r) {
  if (r) return r(e);
  const { type: a, ...i } = e,
    o = ft(i);
  return `${a}:${o}`;
}
function At(e, r, a) {
  return { requirement: e, id: Dt(e, a), fromConstraint: r };
}
var _e = class pt {
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
  jt = 5e3;
function Mt(e) {
  let {
      definitions: r,
      facts: a,
      requirementKeys: i = {},
      defaultTimeout: o = jt,
      onEvaluate: s,
      onError: c,
    } = e,
    u = new Map(),
    h = new Set(),
    p = new Set(),
    d = new Map(),
    E = new Map(),
    T = new Set(),
    A = new Map(),
    O = new Map(),
    D = !1,
    b = new Set(),
    R = new Set(),
    z = new Map(),
    q = [],
    m = new Map();
  function $() {
    for (const [t, n] of Object.entries(r))
      if (n.after)
        for (const l of n.after)
          r[l] && (z.has(l) || z.set(l, new Set()), z.get(l).add(t));
  }
  function v() {
    const t = new Set(),
      n = new Set(),
      l = [];
    function g(x, j) {
      if (t.has(x)) return;
      if (n.has(x)) {
        const W = j.indexOf(x),
          _ = [...j.slice(W), x].join(" → ");
        throw new Error(
          `[Directive] Constraint cycle detected: ${_}. Remove one of the \`after\` dependencies to break the cycle.`,
        );
      }
      n.add(x), j.push(x);
      const F = r[x];
      if (F?.after) for (const W of F.after) r[W] && g(W, j);
      j.pop(), n.delete(x), t.add(x), l.push(x);
    }
    for (const x of Object.keys(r)) g(x, []);
    (q = l), (m = new Map(q.map((x, j) => [x, j])));
  }
  v(), $();
  function C(t, n) {
    return n.async !== void 0 ? n.async : !!p.has(t);
  }
  function I(t) {
    const n = r[t];
    if (!n) throw new Error(`[Directive] Unknown constraint: ${t}`);
    const l = C(t, n);
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
    return u.set(t, g), g;
  }
  function L(t) {
    return u.get(t) ?? I(t);
  }
  function f(t, n) {
    const l = d.get(t) ?? new Set();
    for (const g of l) {
      const x = E.get(g);
      x?.delete(t), x && x.size === 0 && E.delete(g);
    }
    for (const g of n) E.has(g) || E.set(g, new Set()), E.get(g).add(t);
    d.set(t, n);
  }
  function w(t) {
    const n = r[t];
    if (!n) return !1;
    const l = L(t);
    (l.isEvaluating = !0), (l.error = null);
    try {
      let g;
      if (n.deps) (g = n.when(a)), A.set(t, new Set(n.deps));
      else {
        const x = Ce(() => n.when(a));
        (g = x.value), A.set(t, x.deps);
      }
      return g instanceof Promise
        ? (p.add(t),
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
                c?.(t, x),
                !1
              ),
            ))
        : ((l.lastResult = g), (l.isEvaluating = !1), s?.(t, g), g);
    } catch (g) {
      return (
        (l.error = g instanceof Error ? g : new Error(String(g))),
        (l.lastResult = !1),
        (l.isEvaluating = !1),
        c?.(t, g),
        !1
      );
    }
  }
  async function S(t) {
    const n = r[t];
    if (!n) return !1;
    const l = L(t),
      g = n.timeout ?? o;
    if (((l.isEvaluating = !0), (l.error = null), n.deps?.length)) {
      const x = new Set(n.deps);
      f(t, x), A.set(t, x);
    }
    try {
      const x = n.when(a),
        j = await xe(x, g, `Constraint "${t}" timed out after ${g}ms`);
      return (l.lastResult = j), (l.isEvaluating = !1), s?.(t, j), j;
    } catch (x) {
      return (
        (l.error = x instanceof Error ? x : new Error(String(x))),
        (l.lastResult = !1),
        (l.isEvaluating = !1),
        c?.(t, x),
        !1
      );
    }
  }
  function M(t, n) {
    return t == null ? [] : Array.isArray(t) ? t.filter((g) => g != null) : [t];
  }
  function N(t) {
    const n = r[t];
    if (!n) return { requirements: [], deps: new Set() };
    const l = n.require;
    if (typeof l == "function") {
      const { value: g, deps: x } = Ce(() => l(a));
      return { requirements: M(g), deps: x };
    }
    return { requirements: M(l), deps: new Set() };
  }
  function K(t, n) {
    if (n.size === 0) return;
    const l = d.get(t) ?? new Set();
    for (const g of n)
      l.add(g), E.has(g) || E.set(g, new Set()), E.get(g).add(t);
    d.set(t, l);
  }
  let P = null;
  function y() {
    return (
      P ||
        (P = Object.keys(r).sort((t, n) => {
          const l = L(t),
            g = L(n).priority - l.priority;
          if (g !== 0) return g;
          const x = m.get(t) ?? 0,
            j = m.get(n) ?? 0;
          return x - j;
        })),
      P
    );
  }
  for (const t of Object.keys(r)) I(t);
  function k(t) {
    const n = u.get(t);
    if (!n || n.after.length === 0) return !0;
    for (const l of n.after)
      if (r[l] && !h.has(l) && !R.has(l) && !b.has(l)) return !1;
    return !0;
  }
  return {
    async evaluate(t) {
      const n = new _e();
      R.clear();
      let l = y().filter((_) => !h.has(_)),
        g;
      if (!D || !t || t.size === 0) (g = l), (D = !0);
      else {
        const _ = new Set();
        for (const U of t) {
          const J = E.get(U);
          if (J) for (const te of J) h.has(te) || _.add(te);
        }
        for (const U of T) h.has(U) || _.add(U);
        T.clear(), (g = [..._]);
        for (const U of l)
          if (!_.has(U)) {
            const J = O.get(U);
            if (J) for (const te of J) n.add(te);
          }
      }
      function x(_, U) {
        if (h.has(_)) return;
        const J = A.get(_);
        if (!U) {
          J !== void 0 && f(_, J), R.add(_), O.set(_, []);
          return;
        }
        R.delete(_);
        let te, Z;
        try {
          const G = N(_);
          (te = G.requirements), (Z = G.deps);
        } catch (G) {
          c?.(_, G), J !== void 0 && f(_, J), O.set(_, []);
          return;
        }
        if (J !== void 0) {
          const G = new Set(J);
          for (const V of Z) G.add(V);
          f(_, G);
        } else K(_, Z);
        if (te.length > 0) {
          const G = i[_],
            V = te.map((Y) => At(Y, _, G));
          for (const Y of V) n.add(Y);
          O.set(_, V);
        } else O.set(_, []);
      }
      async function j(_) {
        const U = [],
          J = [];
        for (const V of _)
          if (k(V)) J.push(V);
          else {
            U.push(V);
            const Y = O.get(V);
            if (Y) for (const Q of Y) n.add(Q);
          }
        if (J.length === 0) return U;
        const te = [],
          Z = [];
        for (const V of J) L(V).isAsync ? Z.push(V) : te.push(V);
        const G = [];
        for (const V of te) {
          const Y = w(V);
          if (Y instanceof Promise) {
            G.push({ id: V, promise: Y });
            continue;
          }
          x(V, Y);
        }
        if (G.length > 0) {
          const V = await Promise.all(
            G.map(async ({ id: Y, promise: Q }) => ({
              id: Y,
              active: await Q,
            })),
          );
          for (const { id: Y, active: Q } of V) x(Y, Q);
        }
        if (Z.length > 0) {
          const V = await Promise.all(
            Z.map(async (Y) => ({ id: Y, active: await S(Y) })),
          );
          for (const { id: Y, active: Q } of V) x(Y, Q);
        }
        return U;
      }
      let F = g,
        W = g.length + 1;
      while (F.length > 0 && W > 0) {
        const _ = F.length;
        if (((F = await j(F)), F.length === _)) break;
        W--;
      }
      return n.all();
    },
    getState(t) {
      return u.get(t);
    },
    getAllStates() {
      return [...u.values()];
    },
    disable(t) {
      h.add(t), (P = null), O.delete(t);
      const n = d.get(t);
      if (n) {
        for (const l of n) {
          const g = E.get(l);
          g && (g.delete(t), g.size === 0 && E.delete(l));
        }
        d.delete(t);
      }
      A.delete(t);
    },
    enable(t) {
      h.delete(t), (P = null), T.add(t);
    },
    invalidate(t) {
      const n = E.get(t);
      if (n) for (const l of n) T.add(l);
    },
    markResolved(t) {
      b.add(t);
      const n = u.get(t);
      n && (n.lastResolvedAt = Date.now());
      const l = z.get(t);
      if (l) for (const g of l) T.add(g);
    },
    isResolved(t) {
      return b.has(t);
    },
    registerDefinitions(t) {
      for (const [n, l] of Object.entries(t)) (r[n] = l), I(n), T.add(n);
      (P = null), v(), $();
    },
  };
}
function Tt(e) {
  let {
      definitions: r,
      facts: a,
      onCompute: i,
      onInvalidate: o,
      onError: s,
    } = e,
    c = new Map(),
    u = new Map(),
    h = new Map(),
    p = new Map(),
    d = new Set(["__proto__", "constructor", "prototype"]),
    E = 0,
    T = new Set(),
    A = !1,
    O = 100,
    D;
  function b(v) {
    if (!r[v]) throw new Error(`[Directive] Unknown derivation: ${v}`);
    const C = {
      id: v,
      compute: () => z(v),
      cachedValue: void 0,
      dependencies: new Set(),
      isStale: !0,
      isComputing: !1,
    };
    return c.set(v, C), C;
  }
  function R(v) {
    return c.get(v) ?? b(v);
  }
  function z(v) {
    const C = R(v),
      I = r[v];
    if (!I) throw new Error(`[Directive] Unknown derivation: ${v}`);
    if (C.isComputing)
      throw new Error(
        `[Directive] Circular dependency detected in derivation: ${v}`,
      );
    C.isComputing = !0;
    try {
      const { value: L, deps: f } = Ce(() => I(a, D));
      return (
        (C.cachedValue = L), (C.isStale = !1), q(v, f), i?.(v, L, [...f]), L
      );
    } catch (L) {
      throw (s?.(v, L), L);
    } finally {
      C.isComputing = !1;
    }
  }
  function q(v, C) {
    const I = R(v),
      L = I.dependencies;
    for (const f of L)
      if (c.has(f)) {
        const w = p.get(f);
        w?.delete(v), w && w.size === 0 && p.delete(f);
      } else {
        const w = h.get(f);
        w?.delete(v), w && w.size === 0 && h.delete(f);
      }
    for (const f of C)
      r[f]
        ? (p.has(f) || p.set(f, new Set()), p.get(f).add(v))
        : (h.has(f) || h.set(f, new Set()), h.get(f).add(v));
    I.dependencies = C;
  }
  function m() {
    if (!(E > 0 || A)) {
      A = !0;
      try {
        let v = 0;
        while (T.size > 0) {
          if (++v > O) {
            const I = [...T];
            throw (
              (T.clear(),
              new Error(
                `[Directive] Infinite derivation notification loop detected after ${O} iterations. Remaining: ${I.join(", ")}. This usually means a derivation listener is mutating facts that re-trigger the same derivation.`,
              ))
            );
          }
          const C = [...T];
          T.clear();
          for (const I of C) u.get(I)?.forEach((L) => L());
        }
      } finally {
        A = !1;
      }
    }
  }
  function $(v, C = new Set()) {
    if (C.has(v)) return;
    C.add(v);
    const I = c.get(v);
    if (!I || I.isStale) return;
    (I.isStale = !0), o?.(v), T.add(v);
    const L = p.get(v);
    if (L) for (const f of L) $(f, C);
  }
  return (
    (D = new Proxy(
      {},
      {
        get(v, C) {
          if (typeof C == "symbol" || d.has(C)) return;
          Be(C);
          const I = R(C);
          return I.isStale && z(C), I.cachedValue;
        },
      },
    )),
    {
      get(v) {
        const C = R(v);
        return C.isStale && z(v), C.cachedValue;
      },
      isStale(v) {
        return c.get(v)?.isStale ?? !0;
      },
      invalidate(v) {
        const C = h.get(v);
        if (C) {
          E++;
          try {
            for (const I of C) $(I);
          } finally {
            E--, m();
          }
        }
      },
      invalidateMany(v) {
        E++;
        try {
          for (const C of v) {
            const I = h.get(C);
            if (I) for (const L of I) $(L);
          }
        } finally {
          E--, m();
        }
      },
      invalidateAll() {
        E++;
        try {
          for (const v of c.values())
            v.isStale || ((v.isStale = !0), T.add(v.id));
        } finally {
          E--, m();
        }
      },
      subscribe(v, C) {
        for (const I of v) {
          const L = I;
          u.has(L) || u.set(L, new Set()), u.get(L).add(C);
        }
        return () => {
          for (const I of v) {
            const L = I,
              f = u.get(L);
            f?.delete(C), f && f.size === 0 && u.delete(L);
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
        for (const [C, I] of Object.entries(v)) (r[C] = I), b(C);
      },
    }
  );
}
function qt(e) {
  let { definitions: r, facts: a, store: i, onRun: o, onError: s } = e,
    c = new Map(),
    u = null,
    h = !1;
  function p(b) {
    const R = r[b];
    if (!R) throw new Error(`[Directive] Unknown effect: ${b}`);
    const z = {
      id: b,
      enabled: !0,
      hasExplicitDeps: !!R.deps,
      dependencies: R.deps ? new Set(R.deps) : null,
      cleanup: null,
    };
    return c.set(b, z), z;
  }
  function d(b) {
    return c.get(b) ?? p(b);
  }
  function E() {
    return i.toObject();
  }
  function T(b, R) {
    const z = d(b);
    if (!z.enabled) return !1;
    if (z.dependencies) {
      for (const q of z.dependencies) if (R.has(q)) return !0;
      return !1;
    }
    return !0;
  }
  function A(b) {
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
  function O(b, R) {
    if (typeof R == "function")
      if (h)
        try {
          R();
        } catch (z) {
          s?.(b.id, z),
            console.error(
              `[Directive] Effect "${b.id}" cleanup threw an error:`,
              z,
            );
        }
      else b.cleanup = R;
  }
  async function D(b) {
    const R = d(b),
      z = r[b];
    if (!(!R.enabled || !z)) {
      A(R), o?.(b);
      try {
        if (R.hasExplicitDeps) {
          let q;
          if (
            (i.batch(() => {
              q = z.run(a, u);
            }),
            q instanceof Promise)
          ) {
            const m = await q;
            O(R, m);
          } else O(R, q);
        } else {
          let q = null,
            m,
            $ = Ce(
              () => (
                i.batch(() => {
                  m = z.run(a, u);
                }),
                m
              ),
            );
          q = $.deps;
          let v = $.value;
          v instanceof Promise && (v = await v),
            O(R, v),
            (R.dependencies = q.size > 0 ? q : null);
        }
      } catch (q) {
        s?.(b, q),
          console.error(`[Directive] Effect "${b}" threw an error:`, q);
      }
    }
  }
  for (const b of Object.keys(r)) p(b);
  return {
    async runEffects(b) {
      const R = [];
      for (const z of Object.keys(r)) T(z, b) && R.push(z);
      await Promise.all(R.map(D)), (u = E());
    },
    async runAll() {
      const b = Object.keys(r);
      await Promise.all(
        b.map((R) => (d(R).enabled ? D(R) : Promise.resolve())),
      ),
        (u = E());
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
      for (const b of c.values()) A(b);
    },
    registerDefinitions(b) {
      for (const [R, z] of Object.entries(b)) (r[R] = z), p(R);
    },
  };
}
function Bt(e = {}) {
  const {
      delayMs: r = 1e3,
      maxRetries: a = 3,
      backoffMultiplier: i = 2,
      maxDelayMs: o = 3e4,
    } = e,
    s = new Map();
  function c(u) {
    const h = r * Math.pow(i, u - 1);
    return Math.min(h, o);
  }
  return {
    scheduleRetry(u, h, p, d, E) {
      if (d > a) return null;
      const T = c(d),
        A = {
          source: u,
          sourceId: h,
          context: p,
          attempt: d,
          nextRetryTime: Date.now() + T,
          callback: E,
        };
      return s.set(h, A), A;
    },
    getPendingRetries() {
      return Array.from(s.values());
    },
    processDueRetries() {
      const u = Date.now(),
        h = [];
      for (const [p, d] of s) d.nextRetryTime <= u && (h.push(d), s.delete(p));
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
var _t = {
  constraint: "skip",
  resolver: "skip",
  effect: "skip",
  derivation: "skip",
  system: "throw",
};
function zt(e = {}) {
  const { config: r = {}, onError: a, onRecovery: i } = e,
    o = [],
    s = 100,
    c = Bt(r.retryLater),
    u = new Map();
  function h(d, E, T, A) {
    if (T instanceof He) return T;
    const O = T instanceof Error ? T.message : String(T),
      D = d !== "system";
    return new He(O, d, E, A, D);
  }
  function p(d, E, T) {
    const A = (() => {
      switch (d) {
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
    if (typeof A == "function") {
      try {
        A(T, E);
      } catch (O) {
        console.error("[Directive] Error in error handler callback:", O);
      }
      return "skip";
    }
    return typeof A == "string" ? A : _t[d];
  }
  return {
    handleError(d, E, T, A) {
      const O = h(d, E, T, A);
      o.push(O), o.length > s && o.shift();
      try {
        a?.(O);
      } catch (b) {
        console.error("[Directive] Error in onError callback:", b);
      }
      try {
        r.onError?.(O);
      } catch (b) {
        console.error("[Directive] Error in config.onError callback:", b);
      }
      let D = p(d, E, T instanceof Error ? T : new Error(String(T)));
      if (D === "retry-later") {
        const b = (u.get(E) ?? 0) + 1;
        u.set(E, b),
          c.scheduleRetry(d, E, A, b) ||
            ((D = "skip"), u.delete(E), typeof process < "u");
      }
      try {
        i?.(O, D);
      } catch (b) {
        console.error("[Directive] Error in onRecovery callback:", b);
      }
      if (D === "throw") throw O;
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
      return c;
    },
    processDueRetries() {
      return c.processDueRetries();
    },
    clearRetryAttempts(d) {
      u.delete(d), c.cancelRetry(d);
    },
  };
}
function Lt() {
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
      for (const c of e) r(() => c.onFactSet?.(i, o, s));
    },
    emitFactDelete(i, o) {
      for (const s of e) r(() => s.onFactDelete?.(i, o));
    },
    emitFactsBatch(i) {
      for (const o of e) r(() => o.onFactsBatch?.(i));
    },
    emitDerivationCompute(i, o, s) {
      for (const c of e) r(() => c.onDerivationCompute?.(i, o, s));
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
      for (const c of e) r(() => c.onResolverComplete?.(i, o, s));
    },
    emitResolverError(i, o, s) {
      for (const c of e) r(() => c.onResolverError?.(i, o, s));
    },
    emitResolverRetry(i, o, s) {
      for (const c of e) r(() => c.onResolverRetry?.(i, o, s));
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
var Ue = { attempts: 1, backoff: "none", initialDelay: 100, maxDelay: 3e4 },
  Ye = { enabled: !1, windowMs: 50 };
function Je(e, r) {
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
function Pt(e) {
  const {
      definitions: r,
      facts: a,
      store: i,
      onStart: o,
      onComplete: s,
      onError: c,
      onRetry: u,
      onCancel: h,
      onResolutionComplete: p,
    } = e,
    d = new Map(),
    E = new Map(),
    T = 1e3,
    A = new Map(),
    O = new Map(),
    D = 1e3;
  function b() {
    if (E.size > T) {
      const f = E.size - T,
        w = E.keys();
      for (let S = 0; S < f; S++) {
        const M = w.next().value;
        M && E.delete(M);
      }
    }
  }
  function R(f) {
    return (
      typeof f == "object" &&
      f !== null &&
      "requirement" in f &&
      typeof f.requirement == "string"
    );
  }
  function z(f) {
    return (
      typeof f == "object" &&
      f !== null &&
      "requirement" in f &&
      typeof f.requirement == "function"
    );
  }
  function q(f, w) {
    return R(f) ? w.type === f.requirement : z(f) ? f.requirement(w) : !1;
  }
  function m(f) {
    const w = f.type,
      S = O.get(w);
    if (S)
      for (const M of S) {
        const N = r[M];
        if (N && q(N, f)) return M;
      }
    for (const [M, N] of Object.entries(r))
      if (q(N, f)) {
        if (!O.has(w)) {
          if (O.size >= D) {
            const P = O.keys().next().value;
            P !== void 0 && O.delete(P);
          }
          O.set(w, []);
        }
        const K = O.get(w);
        return K.includes(M) || K.push(M), M;
      }
    return null;
  }
  function $(f) {
    return { facts: a, signal: f, snapshot: () => a.$snapshot() };
  }
  async function v(f, w, S) {
    const M = r[f];
    if (!M) return;
    let N = { ...Ue, ...M.retry },
      K = null;
    for (let P = 1; P <= N.attempts; P++) {
      if (S.signal.aborted) return;
      const y = d.get(w.id);
      y &&
        ((y.attempt = P),
        (y.status = {
          state: "running",
          requirementId: w.id,
          startedAt: y.startedAt,
          attempt: P,
        }));
      try {
        const k = $(S.signal);
        if (M.resolve) {
          let n;
          i.batch(() => {
            n = M.resolve(w.requirement, k);
          });
          const l = M.timeout;
          l && l > 0
            ? await xe(n, l, `Resolver "${f}" timed out after ${l}ms`)
            : await n;
        }
        const t = Date.now() - (y?.startedAt ?? Date.now());
        E.set(w.id, {
          state: "success",
          requirementId: w.id,
          completedAt: Date.now(),
          duration: t,
        }),
          b(),
          s?.(f, w, t);
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
          const t = Je(N, P);
          if (
            (u?.(f, w, P + 1),
            await new Promise((n) => {
              const l = setTimeout(n, t),
                g = () => {
                  clearTimeout(l), n();
                };
              S.signal.addEventListener("abort", g, { once: !0 });
            }),
            S.signal.aborted)
          )
            return;
        }
      }
    }
    E.set(w.id, {
      state: "error",
      requirementId: w.id,
      error: K,
      failedAt: Date.now(),
      attempts: N.attempts,
    }),
      b(),
      c?.(f, w, K);
  }
  async function C(f, w) {
    const S = r[f];
    if (!S) return;
    if (!S.resolveBatch && !S.resolveBatchWithResults) {
      await Promise.all(
        w.map((t) => {
          const n = new AbortController();
          return v(f, t, n);
        }),
      );
      return;
    }
    let M = { ...Ue, ...S.retry },
      N = { ...Ye, ...S.batch },
      K = new AbortController(),
      P = Date.now(),
      y = null,
      k = N.timeoutMs ?? S.timeout;
    for (let t = 1; t <= M.attempts; t++) {
      if (K.signal.aborted) return;
      try {
        const n = $(K.signal),
          l = w.map((g) => g.requirement);
        if (S.resolveBatchWithResults) {
          let g, x;
          if (
            (i.batch(() => {
              x = S.resolveBatchWithResults(l, n);
            }),
            k && k > 0
              ? (g = await xe(
                  x,
                  k,
                  `Batch resolver "${f}" timed out after ${k}ms`,
                ))
              : (g = await x),
            g.length !== w.length)
          )
            throw new Error(
              `[Directive] Batch resolver "${f}" returned ${g.length} results but expected ${w.length}. Results array must match input order.`,
            );
          let j = Date.now() - P,
            F = !1;
          for (let W = 0; W < w.length; W++) {
            const _ = w[W],
              U = g[W];
            if (U.success)
              E.set(_.id, {
                state: "success",
                requirementId: _.id,
                completedAt: Date.now(),
                duration: j,
              }),
                s?.(f, _, j);
            else {
              F = !0;
              const J = U.error ?? new Error("Batch item failed");
              E.set(_.id, {
                state: "error",
                requirementId: _.id,
                error: J,
                failedAt: Date.now(),
                attempts: t,
              }),
                c?.(f, _, J);
            }
          }
          if (!F || w.some((W, _) => g[_]?.success)) return;
        } else {
          let g;
          i.batch(() => {
            g = S.resolveBatch(l, n);
          }),
            k && k > 0
              ? await xe(g, k, `Batch resolver "${f}" timed out after ${k}ms`)
              : await g;
          const x = Date.now() - P;
          for (const j of w)
            E.set(j.id, {
              state: "success",
              requirementId: j.id,
              completedAt: Date.now(),
              duration: x,
            }),
              s?.(f, j, x);
          return;
        }
      } catch (n) {
        if (
          ((y = n instanceof Error ? n : new Error(String(n))),
          K.signal.aborted)
        )
          return;
        if (M.shouldRetry && !M.shouldRetry(y, t)) break;
        if (t < M.attempts) {
          const l = Je(M, t);
          for (const g of w) u?.(f, g, t + 1);
          if (
            (await new Promise((g) => {
              const x = setTimeout(g, l),
                j = () => {
                  clearTimeout(x), g();
                };
              K.signal.addEventListener("abort", j, { once: !0 });
            }),
            K.signal.aborted)
          )
            return;
        }
      }
    }
    for (const t of w)
      E.set(t.id, {
        state: "error",
        requirementId: t.id,
        error: y,
        failedAt: Date.now(),
        attempts: M.attempts,
      }),
        c?.(f, t, y);
    b();
  }
  function I(f, w) {
    const S = r[f];
    if (!S) return;
    const M = { ...Ye, ...S.batch };
    A.has(f) || A.set(f, { resolverId: f, requirements: [], timer: null });
    const N = A.get(f);
    N.requirements.push(w),
      N.timer && clearTimeout(N.timer),
      (N.timer = setTimeout(() => {
        L(f);
      }, M.windowMs));
  }
  function L(f) {
    const w = A.get(f);
    if (!w || w.requirements.length === 0) return;
    const S = [...w.requirements];
    (w.requirements = []),
      (w.timer = null),
      C(f, S).then(() => {
        p?.();
      });
  }
  return {
    resolve(f) {
      if (d.has(f.id)) return;
      const w = m(f.requirement);
      if (!w) {
        console.warn(`[Directive] No resolver found for requirement: ${f.id}`);
        return;
      }
      const S = r[w];
      if (!S) return;
      if (S.batch?.enabled) {
        I(w, f);
        return;
      }
      const M = new AbortController(),
        N = Date.now(),
        K = {
          requirementId: f.id,
          resolverId: w,
          controller: M,
          startedAt: N,
          attempt: 1,
          status: { state: "pending", requirementId: f.id, startedAt: N },
          originalRequirement: f,
        };
      d.set(f.id, K),
        o?.(w, f),
        v(w, f, M).finally(() => {
          d.delete(f.id) && p?.();
        });
    },
    cancel(f) {
      const w = d.get(f);
      w &&
        (w.controller.abort(),
        d.delete(f),
        E.set(f, {
          state: "canceled",
          requirementId: f,
          canceledAt: Date.now(),
        }),
        b(),
        h?.(w.resolverId, w.originalRequirement));
    },
    cancelAll() {
      for (const [f] of d) this.cancel(f);
      for (const f of A.values()) f.timer && clearTimeout(f.timer);
      A.clear();
    },
    getStatus(f) {
      const w = d.get(f);
      return w ? w.status : E.get(f) || { state: "idle" };
    },
    getInflight() {
      return [...d.keys()];
    },
    getInflightInfo() {
      return [...d.values()].map((f) => ({
        id: f.requirementId,
        resolverId: f.resolverId,
        startedAt: f.startedAt,
      }));
    },
    isResolving(f) {
      return d.has(f);
    },
    processBatches() {
      for (const f of A.keys()) L(f);
    },
    registerDefinitions(f) {
      for (const [w, S] of Object.entries(f)) r[w] = S;
      O.clear();
    },
  };
}
function Ft(e) {
  let { config: r, facts: a, store: i, onSnapshot: o, onTimeTravel: s } = e,
    c = r.timeTravel ?? !1,
    u = r.maxSnapshots ?? 100,
    h = [],
    p = -1,
    d = 1,
    E = !1,
    T = !1,
    A = [],
    O = null,
    D = -1;
  function b() {
    return i.toObject();
  }
  function R() {
    const q = b();
    return structuredClone(q);
  }
  function z(q) {
    if (!be(q)) {
      console.error(
        "[Directive] Potential prototype pollution detected in snapshot data, skipping restore",
      );
      return;
    }
    i.batch(() => {
      for (const [m, $] of Object.entries(q)) {
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
      return c;
    },
    get isRestoring() {
      return T;
    },
    get isPaused() {
      return E;
    },
    get snapshots() {
      return [...h];
    },
    get currentIndex() {
      return p;
    },
    takeSnapshot(q) {
      if (!c || E)
        return { id: -1, timestamp: Date.now(), facts: {}, trigger: q };
      const m = { id: d++, timestamp: Date.now(), facts: R(), trigger: q };
      for (
        p < h.length - 1 && h.splice(p + 1), h.push(m), p = h.length - 1;
        h.length > u;
      )
        h.shift(), p--;
      return o?.(m), m;
    },
    restore(q) {
      if (c) {
        (E = !0), (T = !0);
        try {
          z(q.facts);
        } finally {
          (E = !1), (T = !1);
        }
      }
    },
    goBack(q = 1) {
      if (!c || h.length === 0) return;
      let m = p,
        $ = p,
        v = A.find((I) => p > I.startIndex && p <= I.endIndex);
      if (v) $ = v.startIndex;
      else if (A.find((I) => p === I.startIndex)) {
        const I = A.find((L) => L.endIndex < p && p - L.endIndex <= q);
        $ = I ? I.startIndex : Math.max(0, p - q);
      } else $ = Math.max(0, p - q);
      if (m === $) return;
      p = $;
      const C = h[p];
      C && (this.restore(C), s?.(m, $));
    },
    goForward(q = 1) {
      if (!c || h.length === 0) return;
      let m = p,
        $ = p,
        v = A.find((I) => p >= I.startIndex && p < I.endIndex);
      if ((v ? ($ = v.endIndex) : ($ = Math.min(h.length - 1, p + q)), m === $))
        return;
      p = $;
      const C = h[p];
      C && (this.restore(C), s?.(m, $));
    },
    goTo(q) {
      if (!c) return;
      const m = h.findIndex((C) => C.id === q);
      if (m === -1) {
        console.warn(`[Directive] Snapshot ${q} not found`);
        return;
      }
      const $ = p;
      p = m;
      const v = h[p];
      v && (this.restore(v), s?.($, m));
    },
    replay() {
      if (!c || h.length === 0) return;
      p = 0;
      const q = h[0];
      q && this.restore(q);
    },
    export() {
      return JSON.stringify({ version: 1, snapshots: h, currentIndex: p });
    },
    import(q) {
      if (c)
        try {
          const m = JSON.parse(q);
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
          (h.length = 0), h.push(...m.snapshots), (p = m.currentIndex);
          const $ = h[p];
          $ && this.restore($);
        } catch (m) {
          console.error("[Directive] Failed to import time-travel data:", m);
        }
    },
    beginChangeset(q) {
      c && ((O = q), (D = p));
    },
    endChangeset() {
      !c ||
        O === null ||
        (p > D && A.push({ label: O, startIndex: D, endIndex: p }),
        (O = null),
        (D = -1));
    },
    pause() {
      E = !0;
    },
    resume() {
      E = !1;
    },
  };
}
function Nt() {
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
function mt(e) {
  const r = Object.create(null),
    a = Object.create(null),
    i = Object.create(null),
    o = Object.create(null),
    s = Object.create(null),
    c = Object.create(null);
  for (const t of e.modules) {
    const n = (l, g) => {
      if (l) {
        for (const x of Object.keys(l))
          if (le.has(x))
            throw new Error(
              `[Directive] Security: Module "${t.id}" has dangerous key "${x}" in ${g}. This could indicate a prototype pollution attempt.`,
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
      t.resolvers && Object.assign(c, t.resolvers);
  }
  let u = null;
  if (e.modules.some((t) => t.snapshotEvents)) {
    u = new Set();
    for (const t of e.modules) {
      const n = t;
      if (n.snapshotEvents) for (const l of n.snapshotEvents) u.add(l);
      else if (n.events) for (const l of Object.keys(n.events)) u.add(l);
    }
  }
  let h = 0,
    p = !1,
    d = Lt();
  for (const t of e.plugins ?? []) d.register(t);
  let E = zt({
      config: e.errorBoundary,
      onError: (t) => d.emitError(t),
      onRecovery: (t, n) => d.emitErrorRecovery(t, n),
    }),
    T = () => {},
    A = () => {},
    O = null,
    { store: D, facts: b } = Rt({
      schema: r,
      onChange: (t, n, l) => {
        d.emitFactSet(t, n, l),
          T(t),
          !O?.isRestoring && (h === 0 && (p = !0), S.changedKeys.add(t), M());
      },
      onBatch: (t) => {
        d.emitFactsBatch(t);
        const n = [];
        for (const l of t) n.push(l.key);
        if ((A(n), !O?.isRestoring)) {
          h === 0 && (p = !0);
          for (const l of t) S.changedKeys.add(l.key);
          M();
        }
      },
    }),
    R = Tt({
      definitions: i,
      facts: b,
      onCompute: (t, n, l) => d.emitDerivationCompute(t, n, l),
      onInvalidate: (t) => d.emitDerivationInvalidate(t),
      onError: (t, n) => {
        E.handleError("derivation", t, n);
      },
    });
  (T = (t) => R.invalidate(t)), (A = (t) => R.invalidateMany(t));
  const z = qt({
      definitions: o,
      facts: b,
      store: D,
      onRun: (t) => d.emitEffectRun(t),
      onError: (t, n) => {
        E.handleError("effect", t, n), d.emitEffectError(t, n);
      },
    }),
    q = Mt({
      definitions: s,
      facts: b,
      onEvaluate: (t, n) => d.emitConstraintEvaluate(t, n),
      onError: (t, n) => {
        E.handleError("constraint", t, n), d.emitConstraintError(t, n);
      },
    }),
    m = Pt({
      definitions: c,
      facts: b,
      store: D,
      onStart: (t, n) => d.emitResolverStart(t, n),
      onComplete: (t, n, l) => {
        d.emitResolverComplete(t, n, l),
          d.emitRequirementMet(n, t),
          q.markResolved(n.fromConstraint);
      },
      onError: (t, n, l) => {
        E.handleError("resolver", t, l, n), d.emitResolverError(t, n, l);
      },
      onRetry: (t, n, l) => d.emitResolverRetry(t, n, l),
      onCancel: (t, n) => {
        d.emitResolverCancel(t, n), d.emitRequirementCanceled(n);
      },
      onResolutionComplete: () => {
        L(), M();
      },
    }),
    $ = new Set();
  function v() {
    for (const t of $) t();
  }
  const C = e.debug?.timeTravel
    ? Ft({
        config: e.debug,
        facts: b,
        store: D,
        onSnapshot: (t) => {
          d.emitSnapshot(t), v();
        },
        onTimeTravel: (t, n) => {
          d.emitTimeTravel(t, n), v();
        },
      })
    : Nt();
  O = C;
  const I = new Set();
  function L() {
    for (const t of I) t();
  }
  let f = 50,
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
  function M() {
    !S.isRunning ||
      S.reconcileScheduled ||
      S.isInitializing ||
      ((S.reconcileScheduled = !0),
      L(),
      queueMicrotask(() => {
        (S.reconcileScheduled = !1),
          S.isRunning && !S.isInitializing && N().catch((t) => {});
      }));
  }
  async function N() {
    if (!S.isReconciling) {
      if ((w++, w > f)) {
        w = 0;
        return;
      }
      (S.isReconciling = !0), L();
      try {
        S.changedKeys.size > 0 &&
          ((u === null || p) &&
            C.takeSnapshot(`facts-changed:${[...S.changedKeys].join(",")}`),
          (p = !1));
        const t = b.$snapshot();
        d.emitReconcileStart(t), await z.runEffects(S.changedKeys);
        const n = new Set(S.changedKeys);
        S.changedKeys.clear();
        const l = await q.evaluate(n),
          g = new _e();
        for (const _ of l) g.add(_), d.emitRequirementCreated(_);
        const { added: x, removed: j } = g.diff(S.previousRequirements);
        for (const _ of j) m.cancel(_.id);
        for (const _ of x) m.resolve(_);
        S.previousRequirements = g;
        const F = m.getInflightInfo(),
          W = {
            unmet: l.filter((_) => !m.isResolving(_.id)),
            inflight: F,
            completed: [],
            canceled: j.map((_) => ({
              id: _.id,
              resolverId: F.find((U) => U.id === _.id)?.resolverId ?? "unknown",
            })),
          };
        d.emitReconcileEnd(W),
          S.isReady ||
            ((S.isReady = !0),
            S.readyResolve && (S.readyResolve(), (S.readyResolve = null)));
      } finally {
        (S.isReconciling = !1),
          S.changedKeys.size > 0 ? M() : S.reconcileScheduled || (w = 0),
          L();
      }
    }
  }
  const K = new Proxy(
      {},
      {
        get(t, n) {
          if (typeof n != "symbol" && !le.has(n)) return R.get(n);
        },
        has(t, n) {
          return typeof n == "symbol" || le.has(n) ? !1 : n in i;
        },
        ownKeys() {
          return Object.keys(i);
        },
        getOwnPropertyDescriptor(t, n) {
          if (typeof n != "symbol" && !le.has(n) && n in i)
            return { configurable: !0, enumerable: !0 };
        },
      },
    ),
    P = new Proxy(
      {},
      {
        get(t, n) {
          if (typeof n != "symbol" && !le.has(n))
            return (l) => {
              const g = a[n];
              if (g) {
                h++, (u === null || u.has(n)) && (p = !0);
                try {
                  D.batch(() => {
                    g(b, { type: n, ...l });
                  });
                } finally {
                  h--;
                }
              }
            };
        },
        has(t, n) {
          return typeof n == "symbol" || le.has(n) ? !1 : n in a;
        },
        ownKeys() {
          return Object.keys(a);
        },
        getOwnPropertyDescriptor(t, n) {
          if (typeof n != "symbol" && !le.has(n) && n in a)
            return { configurable: !0, enumerable: !0 };
        },
      },
    ),
    y = {
      facts: b,
      debug: C.isEnabled ? C : null,
      derive: K,
      events: P,
      constraints: { disable: (t) => q.disable(t), enable: (t) => q.enable(t) },
      effects: {
        disable: (t) => z.disable(t),
        enable: (t) => z.enable(t),
        isEnabled: (t) => z.isEnabled(t),
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
          for (const t of Object.keys(i)) R.get(t);
        }
      },
      start() {
        if (!S.isRunning) {
          S.isInitialized || this.initialize(), (S.isRunning = !0);
          for (const t of e.modules) t.hooks?.onStart?.(y);
          d.emitStart(y), M();
        }
      },
      stop() {
        if (S.isRunning) {
          (S.isRunning = !1), m.cancelAll(), z.cleanupAll();
          for (const t of e.modules) t.hooks?.onStop?.(y);
          d.emitStop(y);
        }
      },
      destroy() {
        this.stop(),
          (S.isDestroyed = !0),
          I.clear(),
          $.clear(),
          d.emitDestroy(y);
      },
      dispatch(t) {
        if (le.has(t.type)) return;
        const n = a[t.type];
        if (n) {
          h++, (u === null || u.has(t.type)) && (p = !0);
          try {
            D.batch(() => {
              n(b, t);
            });
          } finally {
            h--;
          }
        }
      },
      read(t) {
        return R.get(t);
      },
      subscribe(t, n) {
        const l = [],
          g = [];
        for (const j of t) j in i ? l.push(j) : j in r && g.push(j);
        const x = [];
        return (
          l.length > 0 && x.push(R.subscribe(l, n)),
          g.length > 0 && x.push(D.subscribe(g, n)),
          () => {
            for (const j of x) j();
          }
        );
      },
      watch(t, n, l) {
        const g = l?.equalityFn
          ? (j, F) => l.equalityFn(j, F)
          : (j, F) => Object.is(j, F);
        if (t in i) {
          let j = R.get(t);
          return R.subscribe([t], () => {
            const F = R.get(t);
            if (!g(F, j)) {
              const W = j;
              (j = F), n(F, W);
            }
          });
        }
        let x = D.get(t);
        return D.subscribe([t], () => {
          const j = D.get(t);
          if (!g(j, x)) {
            const F = x;
            (x = j), n(j, F);
          }
        });
      },
      when(t, n) {
        return new Promise((l, g) => {
          const x = D.toObject();
          if (t(x)) {
            l();
            return;
          }
          let j,
            F,
            W = () => {
              j?.(), F !== void 0 && clearTimeout(F);
            };
          (j = D.subscribeAll(() => {
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
          unmet: S.previousRequirements.all(),
          inflight: m.getInflightInfo(),
          constraints: q.getAllStates().map((t) => ({
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
        const n = S.previousRequirements.all().find((U) => U.id === t);
        if (!n) return null;
        const l = q.getState(n.fromConstraint),
          g = m.getStatus(t),
          x = {},
          j = D.toObject();
        for (const [U, J] of Object.entries(j)) x[U] = J;
        const F = [
            `Requirement "${n.requirement.type}" (id: ${n.id})`,
            `├─ Produced by constraint: ${n.fromConstraint}`,
            `├─ Constraint priority: ${l?.priority ?? 0}`,
            `├─ Constraint active: ${l?.lastResult ?? "unknown"}`,
            `├─ Resolver status: ${g.state}`,
          ],
          W = Object.entries(n.requirement)
            .filter(([U]) => U !== "type")
            .map(([U, J]) => `${U}=${JSON.stringify(J)}`)
            .join(", ");
        W && F.push(`├─ Requirement payload: { ${W} }`);
        const _ = Object.entries(x).slice(0, 10);
        return (
          _.length > 0 &&
            (F.push("└─ Relevant facts:"),
            _.forEach(([U, J], te) => {
              const Z = te === _.length - 1 ? "   └─" : "   ├─",
                G = typeof J == "object" ? JSON.stringify(J) : String(J);
              F.push(
                `${Z} ${U} = ${G.slice(0, 50)}${G.length > 50 ? "..." : ""}`,
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
            !S.isReconciling &&
            !S.reconcileScheduled
          )
            return;
          if (Date.now() - n > t) {
            const g = [];
            l.inflight.length > 0 &&
              g.push(
                `${l.inflight.length} resolvers inflight: ${l.inflight.map((j) => j.resolverId).join(", ")}`,
              ),
              S.isReconciling && g.push("reconciliation in progress"),
              S.reconcileScheduled && g.push("reconcile scheduled");
            const x = S.previousRequirements.all();
            throw (
              (x.length > 0 &&
                g.push(
                  `${x.length} unmet requirements: ${x.map((j) => j.requirement.type).join(", ")}`,
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
            ttlSeconds: x,
            metadata: j,
            includeVersion: F,
          } = t,
          W = {},
          _ = Object.keys(i),
          U;
        if ((n ? (U = n.filter((Z) => _.includes(Z))) : (U = _), l)) {
          const Z = new Set(l);
          U = U.filter((G) => !Z.has(G));
        }
        for (const Z of U)
          try {
            W[Z] = R.get(Z);
          } catch {}
        if (g && g.length > 0) {
          const Z = D.toObject();
          for (const G of g) G in Z && (W[G] = Z[G]);
        }
        const J = Date.now(),
          te = { data: W, createdAt: J };
        return (
          x !== void 0 && x > 0 && (te.expiresAt = J + x * 1e3),
          F && (te.version = Ot(W)),
          j && (te.metadata = j),
          te
        );
      },
      watchDistributableSnapshot(t, n) {
        let { includeDerivations: l, excludeDerivations: g } = t,
          x = Object.keys(i),
          j;
        if ((l ? (j = l.filter((W) => x.includes(W))) : (j = x), g)) {
          const W = new Set(g);
          j = j.filter((_) => !W.has(_));
        }
        if (j.length === 0) return () => {};
        let F = this.getDistributableSnapshot({
          ...t,
          includeVersion: !0,
        }).version;
        return R.subscribe(j, () => {
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
        if (!be(t))
          throw new Error(
            "[Directive] restore() rejected: snapshot contains potentially dangerous keys (__proto__, constructor, or prototype). This may indicate a prototype pollution attack.",
          );
        D.batch(() => {
          for (const [n, l] of Object.entries(t.facts))
            le.has(n) || D.set(n, l);
        });
      },
      onSettledChange(t) {
        return (
          I.add(t),
          () => {
            I.delete(t);
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
    const n = (l, g) => {
      if (l) {
        for (const x of Object.keys(l))
          if (le.has(x))
            throw new Error(
              `[Directive] Security: Module "${t.id}" has dangerous key "${x}" in ${g}.`,
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
      u === null && (u = new Set(Object.keys(a)));
      for (const l of t.snapshotEvents) u.add(l);
    } else if (u !== null && t.events)
      for (const l of Object.keys(t.events)) u.add(l);
    Object.assign(r, t.schema),
      t.events && Object.assign(a, t.events),
      t.derive && (Object.assign(i, t.derive), R.registerDefinitions(t.derive)),
      t.effects &&
        (Object.assign(o, t.effects), z.registerDefinitions(t.effects)),
      t.constraints &&
        (Object.assign(s, t.constraints), q.registerDefinitions(t.constraints)),
      t.resolvers &&
        (Object.assign(c, t.resolvers), m.registerDefinitions(t.resolvers)),
      D.registerKeys(t.schema),
      e.modules.push(t),
      t.init &&
        D.batch(() => {
          t.init(b);
        }),
      t.hooks?.onInit?.(y),
      S.isRunning && (t.hooks?.onStart?.(y), M());
  }
  (y.registerModule = k), d.emitInit(y);
  for (const t of e.modules) t.hooks?.onInit?.(y);
  return y;
}
var re = Object.freeze(new Set(["__proto__", "constructor", "prototype"])),
  H = "::";
function Wt(e) {
  const r = Object.keys(e),
    a = new Set(),
    i = new Set(),
    o = [],
    s = [];
  function c(u) {
    if (a.has(u)) return;
    if (i.has(u)) {
      const p = s.indexOf(u),
        d = [...s.slice(p), u].join(" → ");
      throw new Error(
        `[Directive] Circular dependency detected: ${d}. Modules cannot have circular crossModuleDeps. Break the cycle by removing one of the cross-module references.`,
      );
    }
    i.add(u), s.push(u);
    const h = e[u];
    if (h?.crossModuleDeps)
      for (const p of Object.keys(h.crossModuleDeps)) r.includes(p) && c(p);
    s.pop(), i.delete(u), a.add(u), o.push(u);
  }
  for (const u of r) c(u);
  return o;
}
var Qe = new WeakMap(),
  Ge = new WeakMap(),
  Xe = new WeakMap(),
  Ze = new WeakMap();
function Kt(e) {
  if ("module" in e) {
    if (!e.module)
      throw new Error(
        "[Directive] createSystem requires a module. Got: " + typeof e.module,
      );
    return Yt(e);
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
  return Ht(r);
}
function Ht(e) {
  const r = e.modules,
    a = new Set(Object.keys(r)),
    i = e.debug?.snapshotModules ? new Set(e.debug.snapshotModules) : null;
  if (e.tickMs !== void 0 && e.tickMs <= 0)
    throw new Error("[Directive] tickMs must be a positive number");
  let o,
    s = e.initOrder ?? "auto";
  if (Array.isArray(s)) {
    const m = s,
      $ = Object.keys(r).filter((v) => !m.includes(v));
    if ($.length > 0)
      throw new Error(
        `[Directive] initOrder is missing modules: ${$.join(", ")}. All modules must be included in the explicit order.`,
      );
    o = m;
  } else s === "declaration" ? (o = Object.keys(r)) : (o = Wt(r));
  let c = e.debug,
    u = e.errorBoundary;
  e.zeroConfig &&
    ((c = { timeTravel: !1, maxSnapshots: 100, ...e.debug }),
    (u = {
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
    const $ = r[m];
    if ($) {
      for (const v of Object.keys($.schema.facts))
        if (v.includes(H))
          throw new Error(
            `[Directive] Schema key "${v}" in module "${m}" contains the reserved separator "${H}". Schema keys cannot contain "${H}".`,
          );
    }
  }
  const h = [];
  for (const m of o) {
    const $ = r[m];
    if (!$) continue;
    const v = $.crossModuleDeps && Object.keys($.crossModuleDeps).length > 0,
      C = v ? Object.keys($.crossModuleDeps) : [],
      I = {};
    for (const [y, k] of Object.entries($.schema.facts)) I[`${m}${H}${y}`] = k;
    const L = {};
    if ($.schema.derivations)
      for (const [y, k] of Object.entries($.schema.derivations))
        L[`${m}${H}${y}`] = k;
    const f = {};
    if ($.schema.events)
      for (const [y, k] of Object.entries($.schema.events))
        f[`${m}${H}${y}`] = k;
    const w = $.init
        ? (y) => {
            const k = ie(y, m);
            $.init(k);
          }
        : void 0,
      S = {};
    if ($.derive)
      for (const [y, k] of Object.entries($.derive))
        S[`${m}${H}${y}`] = (t, n) => {
          const l = v ? ae(t, m, C) : ie(t, m),
            g = ze(n, m);
          return k(l, g);
        };
    const M = {};
    if ($.events)
      for (const [y, k] of Object.entries($.events))
        M[`${m}${H}${y}`] = (t, n) => {
          const l = ie(t, m);
          k(l, n);
        };
    const N = {};
    if ($.constraints)
      for (const [y, k] of Object.entries($.constraints)) {
        const t = k;
        N[`${m}${H}${y}`] = {
          ...t,
          deps: t.deps?.map((n) => `${m}${H}${n}`),
          when: (n) => {
            const l = v ? ae(n, m, C) : ie(n, m);
            return t.when(l);
          },
          require:
            typeof t.require == "function"
              ? (n) => {
                  const l = v ? ae(n, m, C) : ie(n, m);
                  return t.require(l);
                }
              : t.require,
        };
      }
    const K = {};
    if ($.resolvers)
      for (const [y, k] of Object.entries($.resolvers)) {
        const t = k;
        K[`${m}${H}${y}`] = {
          ...t,
          resolve: async (n, l) => {
            const g = Oe(l.facts, r, () => Object.keys(r));
            await t.resolve(n, { facts: g[m], signal: l.signal });
          },
        };
      }
    const P = {};
    if ($.effects)
      for (const [y, k] of Object.entries($.effects)) {
        const t = k;
        P[`${m}${H}${y}`] = {
          ...t,
          run: (n, l) => {
            const g = v ? ae(n, m, C) : ie(n, m),
              x = l ? (v ? ae(l, m, C) : ie(l, m)) : void 0;
            return t.run(g, x);
          },
          deps: t.deps?.map((n) => `${m}${H}${n}`),
        };
      }
    h.push({
      id: $.id,
      schema: {
        facts: I,
        derivations: L,
        events: f,
        requirements: $.schema.requirements ?? {},
      },
      init: w,
      derive: S,
      events: M,
      effects: P,
      constraints: N,
      resolvers: K,
      hooks: $.hooks,
      snapshotEvents:
        i && !i.has(m) ? [] : $.snapshotEvents?.map((y) => `${m}${H}${y}`),
    });
  }
  let p = null,
    d = null;
  function E(m) {
    for (const [$, v] of Object.entries(m))
      if (!re.has($) && a.has($)) {
        if (v && typeof v == "object" && !be(v))
          throw new Error(
            `[Directive] initialFacts/hydrate for namespace "${$}" contains potentially dangerous keys (__proto__, constructor, or prototype). This may indicate a prototype pollution attack.`,
          );
        for (const [C, I] of Object.entries(v))
          re.has(C) || (d.facts[`${$}${H}${C}`] = I);
      }
  }
  d = mt({
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
    debug: c,
    errorBoundary: u,
    tickMs: e.tickMs,
    onAfterModuleInit: () => {
      e.initialFacts && E(e.initialFacts), p && (E(p), (p = null));
    },
  });
  const T = new Map();
  for (const m of Object.keys(r)) {
    const $ = r[m];
    if (!$) continue;
    const v = [];
    for (const C of Object.keys($.schema.facts)) v.push(`${m}${H}${C}`);
    if ($.schema.derivations)
      for (const C of Object.keys($.schema.derivations)) v.push(`${m}${H}${C}`);
    T.set(m, v);
  }
  const A = { names: null };
  function O() {
    return A.names === null && (A.names = Object.keys(r)), A.names;
  }
  let D = Oe(d.facts, r, O),
    b = Vt(d.derive, r, O),
    R = Ut(d, r, O),
    z = null,
    q = e.tickMs;
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
      $ && typeof $ == "object" && (p = $);
    },
    initialize() {
      d.initialize();
    },
    start() {
      if ((d.start(), q && q > 0)) {
        const m = Object.keys(h[0]?.events ?? {}).find(($) =>
          $.endsWith(`${H}tick`),
        );
        m &&
          (z = setInterval(() => {
            d.dispatch({ type: m });
          }, q));
      }
    },
    stop() {
      z && (clearInterval(z), (z = null)), d.stop();
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
          const I = C.slice(0, -2),
            L = T.get(I);
          L && v.push(...L);
        } else v.push(ce(C));
      return d.subscribe(v, $);
    },
    subscribeModule(m, $) {
      const v = T.get(m);
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
      for (const [I, L] of Object.entries(v.data)) {
        const f = I.indexOf(H);
        if (f > 0) {
          const w = I.slice(0, f),
            S = I.slice(f + H.length);
          C[w] || (C[w] = {}), (C[w][S] = L);
        } else C._root || (C._root = {}), (C._root[I] = L);
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
        const I = {};
        for (const [L, f] of Object.entries(C.data)) {
          const w = L.indexOf(H);
          if (w > 0) {
            const S = L.slice(0, w),
              M = L.slice(w + H.length);
            I[S] || (I[S] = {}), (I[S][M] = f);
          } else I._root || (I._root = {}), (I._root[L] = f);
        }
        $({ ...C, data: I });
      });
    },
    registerModule(m, $) {
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
      for (const y of Object.keys($.schema.facts))
        if (y.includes(H))
          throw new Error(
            `[Directive] Schema key "${y}" in module "${m}" contains the reserved separator "${H}".`,
          );
      const v = $,
        C = v.crossModuleDeps && Object.keys(v.crossModuleDeps).length > 0,
        I = C ? Object.keys(v.crossModuleDeps) : [],
        L = {};
      for (const [y, k] of Object.entries(v.schema.facts))
        L[`${m}${H}${y}`] = k;
      const f = v.init
          ? (y) => {
              const k = ie(y, m);
              v.init(k);
            }
          : void 0,
        w = {};
      if (v.derive)
        for (const [y, k] of Object.entries(v.derive))
          w[`${m}${H}${y}`] = (t, n) => {
            const l = C ? ae(t, m, I) : ie(t, m),
              g = ze(n, m);
            return k(l, g);
          };
      const S = {};
      if (v.events)
        for (const [y, k] of Object.entries(v.events))
          S[`${m}${H}${y}`] = (t, n) => {
            const l = ie(t, m);
            k(l, n);
          };
      const M = {};
      if (v.constraints)
        for (const [y, k] of Object.entries(v.constraints)) {
          const t = k;
          M[`${m}${H}${y}`] = {
            ...t,
            deps: t.deps?.map((n) => `${m}${H}${n}`),
            when: (n) => {
              const l = C ? ae(n, m, I) : ie(n, m);
              return t.when(l);
            },
            require:
              typeof t.require == "function"
                ? (n) => {
                    const l = C ? ae(n, m, I) : ie(n, m);
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
              const g = Oe(l.facts, r, O);
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
              const g = C ? ae(n, m, I) : ie(n, m),
                x = l ? (C ? ae(l, m, I) : ie(l, m)) : void 0;
              return t.run(g, x);
            },
            deps: t.deps?.map((n) => `${m}${H}${n}`),
          };
        }
      a.add(m), (r[m] = v), (A.names = null);
      const P = [];
      for (const y of Object.keys(v.schema.facts)) P.push(`${m}${H}${y}`);
      if (v.schema.derivations)
        for (const y of Object.keys(v.schema.derivations))
          P.push(`${m}${H}${y}`);
      T.set(m, P),
        d.registerModule({
          id: v.id,
          schema: L,
          requirements: v.schema.requirements ?? {},
          init: f,
          derive: Object.keys(w).length > 0 ? w : void 0,
          events: Object.keys(S).length > 0 ? S : void 0,
          effects: Object.keys(K).length > 0 ? K : void 0,
          constraints: Object.keys(M).length > 0 ? M : void 0,
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
  let a = Qe.get(e);
  if (a) {
    const o = a.get(r);
    if (o) return o;
  } else (a = new Map()), Qe.set(e, a);
  const i = new Proxy(
    {},
    {
      get(o, s) {
        if (typeof s != "symbol" && !re.has(s))
          return s === "$store" || s === "$snapshot" ? e[s] : e[`${r}${H}${s}`];
      },
      set(o, s, c) {
        return typeof s == "symbol" || re.has(s)
          ? !1
          : ((e[`${r}${H}${s}`] = c), !0);
      },
      has(o, s) {
        return typeof s == "symbol" || re.has(s) ? !1 : `${r}${H}${s}` in e;
      },
      deleteProperty(o, s) {
        return typeof s == "symbol" || re.has(s)
          ? !1
          : (delete e[`${r}${H}${s}`], !0);
      },
    },
  );
  return a.set(r, i), i;
}
function Oe(e, r, a) {
  const i = Ge.get(e);
  if (i) return i;
  const o = new Proxy(
    {},
    {
      get(s, c) {
        if (typeof c != "symbol" && !re.has(c) && Object.hasOwn(r, c))
          return ie(e, c);
      },
      has(s, c) {
        return typeof c == "symbol" || re.has(c) ? !1 : Object.hasOwn(r, c);
      },
      ownKeys() {
        return a();
      },
      getOwnPropertyDescriptor(s, c) {
        if (typeof c != "symbol" && Object.hasOwn(r, c))
          return { configurable: !0, enumerable: !0 };
      },
    },
  );
  return Ge.set(e, o), o;
}
var et = new WeakMap();
function ae(e, r, a) {
  let i = `${r}:${JSON.stringify([...a].sort())}`,
    o = et.get(e);
  if (o) {
    const h = o.get(i);
    if (h) return h;
  } else (o = new Map()), et.set(e, o);
  const s = new Set(a),
    c = ["self", ...a],
    u = new Proxy(
      {},
      {
        get(h, p) {
          if (typeof p != "symbol" && !re.has(p)) {
            if (p === "self") return ie(e, r);
            if (s.has(p)) return ie(e, p);
          }
        },
        has(h, p) {
          return typeof p == "symbol" || re.has(p)
            ? !1
            : p === "self" || s.has(p);
        },
        ownKeys() {
          return c;
        },
        getOwnPropertyDescriptor(h, p) {
          if (typeof p != "symbol" && (p === "self" || s.has(p)))
            return { configurable: !0, enumerable: !0 };
        },
      },
    );
  return o.set(i, u), u;
}
function ze(e, r) {
  let a = Ze.get(e);
  if (a) {
    const o = a.get(r);
    if (o) return o;
  } else (a = new Map()), Ze.set(e, a);
  const i = new Proxy(
    {},
    {
      get(o, s) {
        if (typeof s != "symbol" && !re.has(s)) return e[`${r}${H}${s}`];
      },
      has(o, s) {
        return typeof s == "symbol" || re.has(s) ? !1 : `${r}${H}${s}` in e;
      },
    },
  );
  return a.set(r, i), i;
}
function Vt(e, r, a) {
  const i = Xe.get(e);
  if (i) return i;
  const o = new Proxy(
    {},
    {
      get(s, c) {
        if (typeof c != "symbol" && !re.has(c) && Object.hasOwn(r, c))
          return ze(e, c);
      },
      has(s, c) {
        return typeof c == "symbol" || re.has(c) ? !1 : Object.hasOwn(r, c);
      },
      ownKeys() {
        return a();
      },
      getOwnPropertyDescriptor(s, c) {
        if (typeof c != "symbol" && Object.hasOwn(r, c))
          return { configurable: !0, enumerable: !0 };
      },
    },
  );
  return Xe.set(e, o), o;
}
var tt = new WeakMap();
function Ut(e, r, a) {
  let i = tt.get(e);
  return (
    i || ((i = new Map()), tt.set(e, i)),
    new Proxy(
      {},
      {
        get(o, s) {
          if (typeof s == "symbol" || re.has(s) || !Object.hasOwn(r, s)) return;
          const c = i.get(s);
          if (c) return c;
          const u = new Proxy(
            {},
            {
              get(h, p) {
                if (typeof p != "symbol" && !re.has(p))
                  return (d) => {
                    e.dispatch({ type: `${s}${H}${p}`, ...d });
                  };
              },
            },
          );
          return i.set(s, u), u;
        },
        has(o, s) {
          return typeof s == "symbol" || re.has(s) ? !1 : Object.hasOwn(r, s);
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
function Yt(e) {
  const r = e.module;
  if (!r)
    throw new Error(
      "[Directive] createSystem requires a module. Got: " + typeof r,
    );
  if (e.tickMs !== void 0 && e.tickMs <= 0)
    throw new Error("[Directive] tickMs must be a positive number");
  if (e.initialFacts && !be(e.initialFacts))
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
        for (const [p, d] of Object.entries(e.initialFacts))
          re.has(p) || (s.facts[p] = d);
      if (o) {
        for (const [p, d] of Object.entries(o)) re.has(p) || (s.facts[p] = d);
        o = null;
      }
    },
  });
  let c = new Proxy(
      {},
      {
        get(p, d) {
          if (typeof d != "symbol" && !re.has(d))
            return (E) => {
              s.dispatch({ type: d, ...E });
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
    events: c,
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
      const d = await p();
      d && typeof d == "object" && (o = d);
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
    dispatch(p) {
      s.dispatch(p);
    },
    batch: s.batch.bind(s),
    read(p) {
      return s.read(p);
    },
    subscribe(p, d) {
      return s.subscribe(p, d);
    },
    watch(p, d, E) {
      return s.watch(p, d, E);
    },
    when(p, d) {
      return s.when(p, d);
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
function Fe() {
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
function pe(e, r) {
  return e.length <= r ? e : e.slice(0, r - 3) + "...";
}
function $e(e) {
  try {
    return e.inspect();
  } catch {
    return null;
  }
}
function Jt(e) {
  try {
    return e == null || typeof e != "object"
      ? e
      : JSON.parse(JSON.stringify(e));
  } catch {
    return null;
  }
}
function Qt(e) {
  return e === void 0
    ? 1e3
    : !Number.isFinite(e) || e < 1
      ? (Fe() &&
          console.warn(
            `[directive:devtools] Invalid maxEvents value (${e}), using default 1000`,
          ),
        1e3)
      : Math.floor(e);
}
function Gt() {
  return {
    reconcileCount: 0,
    reconcileTotalMs: 0,
    resolverStats: new Map(),
    effectRunCount: 0,
    effectErrorCount: 0,
    lastReconcileStartMs: 0,
  };
}
var Xt = 200,
  Re = 340,
  he = 16,
  ge = 80,
  rt = 2,
  nt = ["#8b9aff", "#4ade80", "#fbbf24", "#c084fc", "#f472b6", "#22d3ee"];
function Zt() {
  return { entries: new ht(Xt), inflight: new Map() };
}
function er() {
  return {
    derivationDeps: new Map(),
    activeConstraints: new Set(),
    recentlyChangedFacts: new Set(),
    recentlyComputedDerivations: new Set(),
    recentlyActiveConstraints: new Set(),
    animationTimer: null,
  };
}
var tr = 1e4,
  rr = 100;
function nr() {
  return { isRecording: !1, recordedEvents: [], snapshots: [] };
}
var ir = 50,
  it = 200,
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
function or(e, r, a, i) {
  let o = !1,
    s = {
      position: "fixed",
      zIndex: "99999",
      ...(r.includes("bottom") ? { bottom: "12px" } : { top: "12px" }),
      ...(r.includes("right") ? { right: "12px" } : { left: "12px" }),
    },
    c = document.createElement("style");
  (c.textContent = `[data-directive-devtools] summary:focus-visible{outline:2px solid ${B.accent};outline-offset:2px;border-radius:2px}[data-directive-devtools] button:focus-visible{outline:2px solid ${B.accent};outline-offset:2px}`),
    document.head.appendChild(c);
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
  const p = document.createElement("div");
  Object.assign(p.style, {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "8px",
  });
  const d = document.createElement("strong");
  (d.style.color = B.accent),
    (d.textContent =
      e === "default" ? "Directive DevTools" : `DevTools (${e})`);
  const E = document.createElement("button");
  E.setAttribute("aria-label", "Close DevTools"),
    Object.assign(E.style, {
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
    (E.textContent = "×"),
    p.appendChild(d),
    p.appendChild(E),
    h.appendChild(p);
  const T = document.createElement("div");
  (T.style.marginBottom = "6px"), T.setAttribute("aria-live", "polite");
  const A = document.createElement("span");
  (A.style.color = B.green),
    (A.textContent = "Settled"),
    T.appendChild(A),
    h.appendChild(T);
  const O = document.createElement("div");
  Object.assign(O.style, {
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
    O.appendChild(D),
    O.appendChild(b),
    O.appendChild(R),
    h.appendChild(O);
  function z(V, Y) {
    const Q = document.createElement("details");
    Y && (Q.open = !0), (Q.style.marginBottom = "4px");
    const oe = document.createElement("summary");
    Object.assign(oe.style, {
      cursor: "pointer",
      color: B.accent,
      marginBottom: "4px",
    });
    const fe = document.createElement("span");
    (oe.textContent = `${V} (`),
      oe.appendChild(fe),
      oe.appendChild(document.createTextNode(")")),
      (fe.textContent = "0"),
      Q.appendChild(oe);
    const de = document.createElement("table");
    Object.assign(de.style, {
      width: "100%",
      borderCollapse: "collapse",
      fontSize: "11px",
    });
    const Ne = document.createElement("thead"),
      We = document.createElement("tr");
    for (const wt of ["Key", "Value"]) {
      const we = document.createElement("th");
      (we.scope = "col"),
        Object.assign(we.style, {
          textAlign: "left",
          padding: "2px 4px",
          color: B.accent,
        }),
        (we.textContent = wt),
        We.appendChild(we);
    }
    Ne.appendChild(We), de.appendChild(Ne);
    const Ke = document.createElement("tbody");
    return (
      de.appendChild(Ke),
      Q.appendChild(de),
      { details: Q, tbody: Ke, countSpan: fe }
    );
  }
  function q(V, Y) {
    const Q = document.createElement("details");
    Q.style.marginBottom = "4px";
    const oe = document.createElement("summary");
    Object.assign(oe.style, {
      cursor: "pointer",
      color: Y,
      marginBottom: "4px",
    });
    const fe = document.createElement("span");
    (oe.textContent = `${V} (`),
      oe.appendChild(fe),
      oe.appendChild(document.createTextNode(")")),
      (fe.textContent = "0"),
      Q.appendChild(oe);
    const de = document.createElement("ul");
    return (
      Object.assign(de.style, { margin: "0", paddingLeft: "16px" }),
      Q.appendChild(de),
      { details: Q, list: de, countSpan: fe }
    );
  }
  const m = z("Facts", !0);
  h.appendChild(m.details);
  const $ = z("Derivations", !1);
  h.appendChild($.details);
  const v = q("Inflight", B.yellow);
  h.appendChild(v.details);
  const C = q("Unmet", B.red);
  h.appendChild(C.details);
  const I = document.createElement("details");
  I.style.marginBottom = "4px";
  const L = document.createElement("summary");
  Object.assign(L.style, {
    cursor: "pointer",
    color: B.accent,
    marginBottom: "4px",
  }),
    (L.textContent = "Performance"),
    I.appendChild(L);
  const f = document.createElement("div");
  (f.style.fontSize = "10px"),
    (f.style.color = B.muted),
    (f.textContent = "No data yet"),
    I.appendChild(f),
    h.appendChild(I);
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
  const M = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  M.setAttribute("width", "100%"),
    M.setAttribute("height", "120"),
    M.setAttribute("role", "img"),
    M.setAttribute("aria-label", "System dependency graph"),
    (M.style.display = "block"),
    M.setAttribute("viewBox", "0 0 460 120"),
    M.setAttribute("preserveAspectRatio", "xMinYMin meet"),
    w.appendChild(M),
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
    P.setAttribute("viewBox", `0 0 ${Re} 60`),
    P.setAttribute("preserveAspectRatio", "xMinYMin meet");
  const y = document.createElementNS("http://www.w3.org/2000/svg", "text");
  y.setAttribute("x", String(Re / 2)),
    y.setAttribute("y", "30"),
    y.setAttribute("text-anchor", "middle"),
    y.setAttribute("fill", B.muted),
    y.setAttribute("font-size", "10"),
    y.setAttribute("font-family", B.font),
    (y.textContent = "No resolver activity yet"),
    P.appendChild(y),
    N.appendChild(P),
    h.appendChild(N);
  let k, t, n, l;
  if (i) {
    const V = document.createElement("details");
    V.style.marginBottom = "4px";
    const Y = document.createElement("summary");
    Object.assign(Y.style, {
      cursor: "pointer",
      color: B.accent,
      marginBottom: "4px",
    }),
      (n = document.createElement("span")),
      (n.textContent = "0"),
      (Y.textContent = "Events ("),
      Y.appendChild(n),
      Y.appendChild(document.createTextNode(")")),
      V.appendChild(Y),
      (t = document.createElement("div")),
      Object.assign(t.style, {
        maxHeight: "150px",
        overflow: "auto",
        fontSize: "10px",
      }),
      t.setAttribute("role", "log"),
      t.setAttribute("aria-live", "polite"),
      (t.tabIndex = 0);
    const Q = document.createElement("div");
    (Q.style.color = B.muted),
      (Q.style.padding = "4px"),
      (Q.textContent = "Waiting for events..."),
      (Q.className = "dt-events-empty"),
      t.appendChild(Q),
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
  const j = document.createElement("button");
  Object.assign(j.style, {
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
    (j.textContent = "⤓ Export"),
    g.appendChild(x),
    g.appendChild(j),
    h.appendChild(g),
    h.addEventListener(
      "wheel",
      (V) => {
        const Y = h,
          Q = Y.scrollTop === 0 && V.deltaY < 0,
          oe = Y.scrollTop + Y.clientHeight >= Y.scrollHeight && V.deltaY > 0;
        (Q || oe) && V.preventDefault();
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
      E.focus();
  }
  function U() {
    (F = !1),
      (h.style.display = "none"),
      (u.style.display = "block"),
      u.setAttribute("aria-expanded", "false"),
      u.focus();
  }
  u.addEventListener("click", _), E.addEventListener("click", U);
  function J(V) {
    V.key === "Escape" && F && U();
  }
  h.addEventListener("keydown", J);
  function te(V) {
    V.key === "d" &&
      V.shiftKey &&
      (V.ctrlKey || V.metaKey) &&
      (V.preventDefault(), F ? U() : _());
  }
  document.addEventListener("keydown", te);
  function Z() {
    o || (document.body.appendChild(u), document.body.appendChild(h));
  }
  document.body
    ? Z()
    : document.addEventListener("DOMContentLoaded", Z, { once: !0 });
  function G() {
    (o = !0),
      u.removeEventListener("click", _),
      E.removeEventListener("click", U),
      h.removeEventListener("keydown", J),
      document.removeEventListener("keydown", te),
      document.removeEventListener("DOMContentLoaded", Z);
    for (const V of W) clearTimeout(V);
    W.clear(), u.remove(), h.remove(), c.remove();
  }
  return {
    refs: {
      container: h,
      toggleBtn: u,
      titleEl: d,
      statusEl: A,
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
      perfSection: I,
      perfBody: f,
      timeTravelSection: O,
      timeTravelLabel: R,
      undoBtn: D,
      redoBtn: b,
      flowSection: w,
      flowSvg: M,
      timelineSection: N,
      timelineSvg: P,
      eventsSection: k,
      eventsList: t,
      eventsCount: n,
      traceHint: l,
      recordBtn: x,
      exportBtn: j,
    },
    destroy: G,
    isOpen: () => F,
    flashTimers: W,
  };
}
function Ee(e, r, a, i, o, s) {
  let c = gt(i),
    u = e.get(a);
  if (u) {
    const h = u.cells;
    if (h[1] && ((h[1].textContent = c), o && s)) {
      const p = h[1];
      p.style.background = "rgba(139, 154, 255, 0.25)";
      const d = setTimeout(() => {
        (p.style.background = ""), s.delete(d);
      }, 300);
      s.add(d);
    }
  } else {
    (u = document.createElement("tr")),
      (u.style.borderBottom = `1px solid ${B.rowBorder}`);
    const h = document.createElement("td");
    Object.assign(h.style, { padding: "2px 4px", color: B.muted }),
      (h.textContent = a);
    const p = document.createElement("td");
    (p.style.padding = "2px 4px"),
      (p.textContent = c),
      u.appendChild(h),
      u.appendChild(p),
      r.appendChild(u),
      e.set(a, u);
  }
}
function sr(e, r) {
  const a = e.get(r);
  a && (a.remove(), e.delete(r));
}
function De(e, r, a) {
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
function Ae(e, r, a) {
  const i = r === 0 && a === 0;
  (e.statusEl.style.color = i ? B.green : B.yellow),
    (e.statusEl.textContent = i ? "Settled" : "Working..."),
    (e.toggleBtn.textContent = i ? "Directive" : "Directive..."),
    e.toggleBtn.setAttribute(
      "aria-label",
      `Open Directive DevTools${i ? "" : " (system working)"}`,
    );
}
function ot(e, r, a, i) {
  const o = Object.keys(a.derive);
  if (((e.derivCount.textContent = String(o.length)), o.length === 0)) {
    r.clear(), e.derivBody.replaceChildren();
    const c = document.createElement("tr"),
      u = document.createElement("td");
    (u.colSpan = 2),
      (u.style.color = B.muted),
      (u.style.fontSize = "10px"),
      (u.textContent = "No derivations defined"),
      c.appendChild(u),
      e.derivBody.appendChild(c);
    return;
  }
  const s = new Set(o);
  for (const [c, u] of r) s.has(c) || (u.remove(), r.delete(c));
  for (const c of o) {
    let u;
    try {
      u = gt(a.read(c));
    } catch {
      u = "<error>";
    }
    Ee(r, e.derivBody, c, u, !0, i);
  }
}
function lr(e, r, a, i) {
  const o = e.eventsList.querySelector(".dt-events-empty");
  o && o.remove();
  const s = document.createElement("div");
  Object.assign(s.style, {
    padding: "2px 4px",
    borderBottom: `1px solid ${B.rowBorder}`,
    fontFamily: "inherit",
  });
  let c = new Date(),
    u = `${String(c.getHours()).padStart(2, "0")}:${String(c.getMinutes()).padStart(2, "0")}:${String(c.getSeconds()).padStart(2, "0")}.${String(c.getMilliseconds()).padStart(3, "0")}`,
    h;
  try {
    const T = JSON.stringify(a);
    h = pe(T, 60);
  } catch {
    h = "{}";
  }
  const p = document.createElement("span");
  (p.style.color = B.closeBtn), (p.textContent = u);
  const d = document.createElement("span");
  (d.style.color = B.accent), (d.textContent = ` ${r} `);
  const E = document.createElement("span");
  for (
    E.style.color = B.muted,
      E.textContent = h,
      s.appendChild(p),
      s.appendChild(d),
      s.appendChild(E),
      e.eventsList.prepend(s);
    e.eventsList.childElementCount > ir;
  )
    e.eventsList.lastElementChild?.remove();
  e.eventsCount.textContent = String(i);
}
function ar(e, r) {
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
      (c, u) => u[1].totalMs - c[1].totalMs,
    );
    for (const [c, u] of s) {
      const h = u.count > 0 ? (u.totalMs / u.count).toFixed(1) : "0",
        p = document.createElement("div");
      (p.style.paddingLeft = "8px"),
        (p.textContent = `${c}: ${u.count}x, avg ${h}ms${u.errors > 0 ? `, ${u.errors} err` : ""}`),
        u.errors > 0 && (p.style.color = B.red),
        e.perfBody.appendChild(p);
    }
  }
}
function st(e, r) {
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
    c = i < o - 1;
  (e.undoBtn.disabled = !s),
    (e.undoBtn.style.opacity = s ? "1" : "0.4"),
    (e.redoBtn.disabled = !c),
    (e.redoBtn.style.opacity = c ? "1" : "0.4");
}
function cr(e, r) {
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
function dr(e, r, a, i, o, s) {
  return [
    e.join(","),
    r.join(","),
    a.map((c) => `${c.id}:${c.active}`).join(","),
    [...i.entries()].map(([c, u]) => `${c}:${u.status}:${u.type}`).join(","),
    o.join(","),
    s.join(","),
  ].join("|");
}
function ur(e, r, a, i, o) {
  for (const s of a) {
    const c = e.nodes.get(`0:${s}`);
    if (!c) continue;
    const u = r.recentlyChangedFacts.has(s);
    c.rect.setAttribute("fill", u ? B.text + "33" : "none"),
      c.rect.setAttribute("stroke-width", u ? "2" : "1");
  }
  for (const s of i) {
    const c = e.nodes.get(`1:${s}`);
    if (!c) continue;
    const u = r.recentlyComputedDerivations.has(s);
    c.rect.setAttribute("fill", u ? B.accent + "33" : "none"),
      c.rect.setAttribute("stroke-width", u ? "2" : "1");
  }
  for (const s of o) {
    const c = e.nodes.get(`2:${s}`);
    if (!c) continue;
    const u = r.recentlyActiveConstraints.has(s),
      h = c.rect.getAttribute("stroke") ?? B.muted;
    c.rect.setAttribute("fill", u ? h + "33" : "none"),
      c.rect.setAttribute("stroke-width", u ? "2" : "1");
  }
}
function lt(e, r, a) {
  const i = $e(r);
  if (!i) return;
  let o;
  try {
    o = Object.keys(r.facts.$store.toObject());
  } catch {
    o = [];
  }
  const s = Object.keys(r.derive),
    c = i.constraints,
    u = i.unmet,
    h = i.inflight,
    p = Object.keys(i.resolvers),
    d = new Map();
  for (const y of u)
    d.set(y.id, {
      type: y.requirement.type,
      fromConstraint: y.fromConstraint,
      status: "unmet",
    });
  for (const y of h)
    d.set(y.id, { type: y.resolverId, fromConstraint: "", status: "inflight" });
  if (o.length === 0 && s.length === 0 && c.length === 0 && p.length === 0) {
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
  const E = h.map((y) => y.resolverId).sort(),
    T = dr(o, s, c, d, p, E),
    A = je.get(e.flowSvg);
  if (A && A.fingerprint === T) {
    ur(
      A,
      a,
      o,
      s,
      c.map((y) => y.id),
    );
    return;
  }
  const O = X.nodeW + X.colGap,
    D = [5, 5 + O, 5 + O * 2, 5 + O * 3, 5 + O * 4],
    b = D[4] + X.nodeW + 5;
  function R(y) {
    let k = X.startY + 12;
    return y.map((t) => {
      const n = { ...t, y: k };
      return (k += X.nodeH + X.nodeGap), n;
    });
  }
  const z = R(o.map((y) => ({ id: y, label: pe(y, X.labelMaxChars) }))),
    q = R(s.map((y) => ({ id: y, label: pe(y, X.labelMaxChars) }))),
    m = R(
      c.map((y) => ({
        id: y.id,
        label: pe(y.id, X.labelMaxChars),
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
    v = R(p.map((y) => ({ id: y, label: pe(y, X.labelMaxChars) }))),
    C = Math.max(z.length, q.length, m.length, $.length, v.length, 1),
    I = X.startY + 12 + C * (X.nodeH + X.nodeGap) + 8;
  e.flowSvg.replaceChildren(),
    e.flowSvg.setAttribute("viewBox", `0 0 ${b} ${I}`),
    e.flowSvg.setAttribute(
      "aria-label",
      `Dependency graph: ${o.length} facts, ${s.length} derivations, ${c.length} constraints, ${d.size} requirements, ${p.length} resolvers`,
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
  const f = { fingerprint: T, nodes: new Map() };
  function w(y, k, t, n, l, g, x, j) {
    const F = document.createElementNS("http://www.w3.org/2000/svg", "g"),
      W = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    W.setAttribute("x", String(k)),
      W.setAttribute("y", String(t - 6)),
      W.setAttribute("width", String(X.nodeW)),
      W.setAttribute("height", String(X.nodeH)),
      W.setAttribute("rx", "3"),
      W.setAttribute("fill", j ? g + "33" : "none"),
      W.setAttribute("stroke", g),
      W.setAttribute("stroke-width", j ? "2" : "1"),
      W.setAttribute("opacity", x ? "0.35" : "1"),
      F.appendChild(W);
    const _ = document.createElementNS("http://www.w3.org/2000/svg", "text");
    return (
      _.setAttribute("x", String(k + 4)),
      _.setAttribute("y", String(t + 4)),
      _.setAttribute("fill", g),
      _.setAttribute("font-size", String(X.fontSize)),
      _.setAttribute("font-family", B.font),
      _.setAttribute("opacity", x ? "0.35" : "1"),
      (_.textContent = l),
      F.appendChild(_),
      e.flowSvg.appendChild(F),
      f.nodes.set(`${y}:${n}`, { g: F, rect: W, text: _ }),
      { midX: k + X.nodeW / 2, midY: t }
    );
  }
  function S(y, k, t, n, l, g) {
    const x = document.createElementNS("http://www.w3.org/2000/svg", "line");
    x.setAttribute("x1", String(y)),
      x.setAttribute("y1", String(k)),
      x.setAttribute("x2", String(t)),
      x.setAttribute("y2", String(n)),
      x.setAttribute("stroke", l),
      x.setAttribute("stroke-width", "1"),
      x.setAttribute("stroke-dasharray", "3,2"),
      x.setAttribute("opacity", "0.7"),
      e.flowSvg.appendChild(x);
  }
  const M = new Map(),
    N = new Map(),
    K = new Map(),
    P = new Map();
  for (const y of z) {
    const k = a.recentlyChangedFacts.has(y.id),
      t = w(0, D[0], y.y, y.id, y.label, B.text, !1, k);
    M.set(y.id, t);
  }
  for (const y of q) {
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
    K.set(y.id, t);
  }
  for (const y of $) {
    const k = y.status === "unmet" ? B.red : B.yellow,
      t = w(3, D[3], y.y, y.id, pe(y.type, X.labelMaxChars), k, !1, !1);
    P.set(y.id, t);
  }
  for (const y of v) {
    const k = h.some((t) => t.resolverId === y.id);
    w(4, D[4], y.y, y.id, y.label, k ? B.green : B.muted, !k, !1);
  }
  for (const y of q) {
    const k = a.derivationDeps.get(y.id),
      t = N.get(y.id);
    if (k && t)
      for (const n of k) {
        const l = M.get(n);
        l &&
          S(
            l.midX + X.nodeW / 2,
            l.midY,
            t.midX - X.nodeW / 2,
            t.midY,
            B.accent,
          );
      }
  }
  for (const y of $) {
    const k = K.get(y.fromConstraint),
      t = P.get(y.id);
    k &&
      t &&
      S(k.midX + X.nodeW / 2, k.midY, t.midX - X.nodeW / 2, t.midY, B.muted);
  }
  for (const y of h) {
    const k = P.get(y.id);
    if (k) {
      const t = v.find((n) => n.id === y.resolverId);
      t && S(k.midX + X.nodeW / 2, k.midY, D[4], t.y, B.green);
    }
  }
  je.set(e.flowSvg, f);
}
function fr(e) {
  e.animationTimer && clearTimeout(e.animationTimer),
    (e.animationTimer = setTimeout(() => {
      e.recentlyChangedFacts.clear(),
        e.recentlyComputedDerivations.clear(),
        e.recentlyActiveConstraints.clear(),
        (e.animationTimer = null);
    }, 600));
}
function pr(e, r) {
  const a = r.entries.toArray();
  if (a.length === 0) return;
  e.timelineSvg.replaceChildren();
  let i = 1 / 0,
    o = -1 / 0;
  for (const A of a)
    A.startMs < i && (i = A.startMs), A.endMs > o && (o = A.endMs);
  const s = performance.now();
  for (const A of r.inflight.values()) A < i && (i = A), s > o && (o = s);
  const c = o - i || 1,
    u = Re - ge - 10,
    h = [],
    p = new Set();
  for (const A of a)
    p.has(A.resolver) || (p.add(A.resolver), h.push(A.resolver));
  for (const A of r.inflight.keys()) p.has(A) || (p.add(A), h.push(A));
  const d = h.slice(-12),
    E = he * d.length + 20;
  e.timelineSvg.setAttribute("viewBox", `0 0 ${Re} ${E}`),
    e.timelineSvg.setAttribute("height", String(Math.min(E, 200)));
  const T = 5;
  for (let A = 0; A <= T; A++) {
    const O = ge + (u * A) / T,
      D = (c * A) / T,
      b = document.createElementNS("http://www.w3.org/2000/svg", "text");
    b.setAttribute("x", String(O)),
      b.setAttribute("y", "8"),
      b.setAttribute("fill", B.muted),
      b.setAttribute("font-size", "6"),
      b.setAttribute("font-family", B.font),
      b.setAttribute("text-anchor", "middle"),
      (b.textContent =
        D < 1e3 ? `${D.toFixed(0)}ms` : `${(D / 1e3).toFixed(1)}s`),
      e.timelineSvg.appendChild(b);
    const R = document.createElementNS("http://www.w3.org/2000/svg", "line");
    R.setAttribute("x1", String(O)),
      R.setAttribute("y1", "10"),
      R.setAttribute("x2", String(O)),
      R.setAttribute("y2", String(E)),
      R.setAttribute("stroke", B.border),
      R.setAttribute("stroke-width", "0.5"),
      e.timelineSvg.appendChild(R);
  }
  for (let A = 0; A < d.length; A++) {
    const O = d[A],
      D = 12 + A * he,
      b = A % nt.length,
      R = nt[b],
      z = document.createElementNS("http://www.w3.org/2000/svg", "text");
    z.setAttribute("x", String(ge - 4)),
      z.setAttribute("y", String(D + he / 2 + 3)),
      z.setAttribute("fill", B.muted),
      z.setAttribute("font-size", "7"),
      z.setAttribute("font-family", B.font),
      z.setAttribute("text-anchor", "end"),
      (z.textContent = pe(O, 12)),
      e.timelineSvg.appendChild(z);
    const q = a.filter(($) => $.resolver === O);
    for (const $ of q) {
      const v = ge + (($.startMs - i) / c) * u,
        C = Math.max((($.endMs - $.startMs) / c) * u, rt),
        I = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      I.setAttribute("x", String(v)),
        I.setAttribute("y", String(D + 2)),
        I.setAttribute("width", String(C)),
        I.setAttribute("height", String(he - 4)),
        I.setAttribute("rx", "2"),
        I.setAttribute("fill", $.error ? B.red : R),
        I.setAttribute("opacity", "0.8");
      const L = document.createElementNS("http://www.w3.org/2000/svg", "title"),
        f = $.endMs - $.startMs;
      (L.textContent = `${O}: ${f.toFixed(1)}ms${$.error ? " (error)" : ""}`),
        I.appendChild(L),
        e.timelineSvg.appendChild(I);
    }
    const m = r.inflight.get(O);
    if (m !== void 0) {
      const $ = ge + ((m - i) / c) * u,
        v = Math.max(((s - m) / c) * u, rt),
        C = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      C.setAttribute("x", String($)),
        C.setAttribute("y", String(D + 2)),
        C.setAttribute("width", String(v)),
        C.setAttribute("height", String(he - 4)),
        C.setAttribute("rx", "2"),
        C.setAttribute("fill", R),
        C.setAttribute("opacity", "0.4"),
        C.setAttribute("stroke", R),
        C.setAttribute("stroke-width", "1"),
        C.setAttribute("stroke-dasharray", "3,2");
      const I = document.createElementNS("http://www.w3.org/2000/svg", "title");
      (I.textContent = `${O}: inflight ${(s - m).toFixed(0)}ms`),
        C.appendChild(I),
        e.timelineSvg.appendChild(C);
    }
  }
  e.timelineSvg.setAttribute(
    "aria-label",
    `Timeline: ${a.length} resolver executions across ${d.length} resolvers`,
  );
}
function mr() {
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
              c = setInterval(() => {
                const h = i ? e.get(i) : e.values().next().value;
                h && !s && ((s = !0), h.subscribers.add(a));
              }, 100),
              u = setTimeout(() => clearInterval(c), 1e4);
            return () => {
              clearInterval(c), clearTimeout(u);
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
            const c = s.maxEvents,
              u = o.events,
              h = u.length > c ? u.length - c : 0;
            s.events.clear();
            for (let p = h; p < u.length; p++) {
              const d = u[p];
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
          const i = a ? e.get(a) : e.values().next().value;
          i && i.events.clear();
        },
      };
    return (
      Object.defineProperty(window, "__DIRECTIVE__", {
        value: r,
        writable: !1,
        configurable: Fe(),
        enumerable: !0,
      }),
      r
    );
  }
  return window.__DIRECTIVE__;
}
function hr(e = {}) {
  const {
      name: r = "default",
      trace: a = !1,
      maxEvents: i,
      panel: o = !1,
      position: s = "bottom-right",
      defaultOpen: c = !1,
    } = e,
    u = Qt(i),
    h = mr(),
    p = {
      system: null,
      events: new ht(u),
      maxEvents: u,
      subscribers: new Set(),
    };
  h.systems.set(r, p);
  let d = (n, l) => {
      const g = { timestamp: Date.now(), type: n, data: l };
      a && p.events.push(g);
      for (const x of p.subscribers)
        try {
          x(g);
        } catch {}
    },
    E = null,
    T = new Map(),
    A = new Map(),
    O = Gt(),
    D = er(),
    b = nr(),
    R = Zt(),
    z = o && typeof window < "u" && typeof document < "u" && Fe(),
    q = null,
    m = 0,
    $ = 1,
    v = 2,
    C = 4,
    I = 8,
    L = 16,
    f = 32,
    w = 64,
    S = 128,
    M = new Map(),
    N = new Set(),
    K = null;
  function P(n) {
    (m |= n),
      q === null &&
        typeof requestAnimationFrame < "u" &&
        (q = requestAnimationFrame(y));
  }
  function y() {
    if (((q = null), !E || !p.system)) {
      m = 0;
      return;
    }
    const n = E.refs,
      l = p.system,
      g = m;
    if (((m = 0), g & $)) {
      for (const x of N) sr(T, x);
      N.clear();
      for (const [x, { value: j, flash: F }] of M)
        Ee(T, n.factsBody, x, j, F, E.flashTimers);
      M.clear(), (n.factsCount.textContent = String(T.size));
    }
    if ((g & v && ot(n, A, l, E.flashTimers), g & I))
      if (K) Ae(n, K.inflight.length, K.unmet.length);
      else {
        const x = $e(l);
        x && Ae(n, x.inflight.length, x.unmet.length);
      }
    if (g & C)
      if (K) De(n, K.inflight, K.unmet);
      else {
        const x = $e(l);
        x && De(n, x.inflight, x.unmet);
      }
    g & L && ar(n, O),
      g & f && lt(n, l, D),
      g & w && st(n, l),
      g & S && pr(n, R);
  }
  function k(n, l) {
    E && a && lr(E.refs, n, l, p.events.size);
  }
  function t(n, l) {
    b.isRecording &&
      b.recordedEvents.length < tr &&
      b.recordedEvents.push({ timestamp: Date.now(), type: n, data: Jt(l) });
  }
  return {
    name: "devtools",
    onInit: (n) => {
      if (
        ((p.system = n),
        d("init", {}),
        typeof window < "u" &&
          console.log(
            `%c[Directive Devtools]%c System "${r}" initialized. Access via window.__DIRECTIVE__`,
            "color: #7c3aed; font-weight: bold",
            "color: inherit",
          ),
        z)
      ) {
        const l = p.system;
        E = or(r, s, c, a);
        const g = E.refs;
        try {
          const j = l.facts.$store.toObject();
          for (const [F, W] of Object.entries(j)) Ee(T, g.factsBody, F, W, !1);
          g.factsCount.textContent = String(Object.keys(j).length);
        } catch {}
        ot(g, A, l);
        const x = $e(l);
        x &&
          (Ae(g, x.inflight.length, x.unmet.length),
          De(g, x.inflight, x.unmet)),
          st(g, l),
          cr(g, l),
          lt(g, l, D),
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
            const j =
                b.recordedEvents.length > 0
                  ? b.recordedEvents
                  : p.events.toArray(),
              F = JSON.stringify(
                {
                  version: 1,
                  name: r,
                  exportedAt: Date.now(),
                  events: j,
                  snapshots: b.snapshots,
                },
                null,
                2,
              ),
              W = new Blob([F], { type: "application/json" }),
              _ = URL.createObjectURL(W),
              U = document.createElement("a");
            (U.href = _),
              (U.download = `directive-session-${r}-${Date.now()}.json`),
              U.click(),
              URL.revokeObjectURL(_);
          });
      }
    },
    onStart: (n) => {
      d("start", {}), k("start", {}), t("start", {});
    },
    onStop: (n) => {
      d("stop", {}), k("stop", {}), t("stop", {});
    },
    onDestroy: (n) => {
      d("destroy", {}),
        h.systems.delete(r),
        q !== null &&
          typeof cancelAnimationFrame < "u" &&
          (cancelAnimationFrame(q), (q = null)),
        D.animationTimer && clearTimeout(D.animationTimer),
        E && (E.destroy(), (E = null), T.clear(), A.clear());
    },
    onFactSet: (n, l, g) => {
      d("fact.set", { key: n, value: l, prev: g }),
        t("fact.set", { key: n, value: l, prev: g }),
        D.recentlyChangedFacts.add(n),
        E &&
          p.system &&
          (M.set(n, { value: l, flash: !0 }),
          N.delete(n),
          P($),
          k("fact.set", { key: n, value: l }));
    },
    onFactDelete: (n, l) => {
      d("fact.delete", { key: n, prev: l }),
        t("fact.delete", { key: n, prev: l }),
        E && (N.add(n), M.delete(n), P($), k("fact.delete", { key: n }));
    },
    onFactsBatch: (n) => {
      if (
        (d("facts.batch", { changes: n }),
        t("facts.batch", { count: n.length }),
        E && p.system)
      ) {
        for (const l of n)
          l.type === "delete"
            ? (N.add(l.key), M.delete(l.key))
            : (D.recentlyChangedFacts.add(l.key),
              M.set(l.key, { value: l.value, flash: !0 }),
              N.delete(l.key));
        P($), k("facts.batch", { count: n.length });
      }
    },
    onDerivationCompute: (n, l, g) => {
      d("derivation.compute", { id: n, value: l, deps: g }),
        t("derivation.compute", { id: n, deps: g }),
        D.derivationDeps.set(n, g),
        D.recentlyComputedDerivations.add(n),
        k("derivation.compute", { id: n, deps: g });
    },
    onDerivationInvalidate: (n) => {
      d("derivation.invalidate", { id: n }),
        k("derivation.invalidate", { id: n });
    },
    onReconcileStart: (n) => {
      d("reconcile.start", {}),
        (O.lastReconcileStartMs = performance.now()),
        k("reconcile.start", {}),
        t("reconcile.start", {});
    },
    onReconcileEnd: (n) => {
      if (
        (d("reconcile.end", n),
        t("reconcile.end", {
          unmet: n.unmet.length,
          inflight: n.inflight.length,
          completed: n.completed.length,
        }),
        O.lastReconcileStartMs > 0)
      ) {
        const l = performance.now() - O.lastReconcileStartMs;
        O.reconcileCount++,
          (O.reconcileTotalMs += l),
          (O.lastReconcileStartMs = 0);
      }
      if (b.isRecording && p.system && b.snapshots.length < rr)
        try {
          b.snapshots.push({
            timestamp: Date.now(),
            facts: p.system.facts.$store.toObject(),
          });
        } catch {}
      E &&
        p.system &&
        ((K = n),
        fr(D),
        P(v | I | C | L | f | w),
        k("reconcile.end", {
          unmet: n.unmet.length,
          inflight: n.inflight.length,
        }));
    },
    onConstraintEvaluate: (n, l) => {
      d("constraint.evaluate", { id: n, active: l }),
        t("constraint.evaluate", { id: n, active: l }),
        l
          ? (D.activeConstraints.add(n), D.recentlyActiveConstraints.add(n))
          : D.activeConstraints.delete(n),
        k("constraint.evaluate", { id: n, active: l });
    },
    onConstraintError: (n, l) => {
      d("constraint.error", { id: n, error: String(l) }),
        k("constraint.error", { id: n, error: String(l) });
    },
    onRequirementCreated: (n) => {
      d("requirement.created", { id: n.id, type: n.requirement.type }),
        t("requirement.created", { id: n.id, type: n.requirement.type }),
        k("requirement.created", { id: n.id, type: n.requirement.type });
    },
    onRequirementMet: (n, l) => {
      d("requirement.met", { id: n.id, byResolver: l }),
        t("requirement.met", { id: n.id, byResolver: l }),
        k("requirement.met", { id: n.id, byResolver: l });
    },
    onRequirementCanceled: (n) => {
      d("requirement.canceled", { id: n.id }),
        t("requirement.canceled", { id: n.id }),
        k("requirement.canceled", { id: n.id });
    },
    onResolverStart: (n, l) => {
      d("resolver.start", { resolver: n, requirementId: l.id }),
        t("resolver.start", { resolver: n, requirementId: l.id }),
        R.inflight.set(n, performance.now()),
        E &&
          p.system &&
          (P(C | I | S),
          k("resolver.start", { resolver: n, requirementId: l.id }));
    },
    onResolverComplete: (n, l, g) => {
      d("resolver.complete", { resolver: n, requirementId: l.id, duration: g }),
        t("resolver.complete", {
          resolver: n,
          requirementId: l.id,
          duration: g,
        });
      const x = O.resolverStats.get(n) ?? { count: 0, totalMs: 0, errors: 0 };
      if (
        (x.count++,
        (x.totalMs += g),
        O.resolverStats.set(n, x),
        O.resolverStats.size > it)
      ) {
        const F = O.resolverStats.keys().next().value;
        F !== void 0 && O.resolverStats.delete(F);
      }
      const j = R.inflight.get(n);
      R.inflight.delete(n),
        j !== void 0 &&
          R.entries.push({
            resolver: n,
            startMs: j,
            endMs: performance.now(),
            error: !1,
          }),
        E &&
          p.system &&
          (P(C | I | L | S),
          k("resolver.complete", { resolver: n, duration: g }));
    },
    onResolverError: (n, l, g) => {
      d("resolver.error", {
        resolver: n,
        requirementId: l.id,
        error: String(g),
      }),
        t("resolver.error", {
          resolver: n,
          requirementId: l.id,
          error: String(g),
        });
      const x = O.resolverStats.get(n) ?? { count: 0, totalMs: 0, errors: 0 };
      if ((x.errors++, O.resolverStats.set(n, x), O.resolverStats.size > it)) {
        const F = O.resolverStats.keys().next().value;
        F !== void 0 && O.resolverStats.delete(F);
      }
      const j = R.inflight.get(n);
      R.inflight.delete(n),
        j !== void 0 &&
          R.entries.push({
            resolver: n,
            startMs: j,
            endMs: performance.now(),
            error: !0,
          }),
        E &&
          p.system &&
          (P(C | I | L | S),
          k("resolver.error", { resolver: n, error: String(g) }));
    },
    onResolverRetry: (n, l, g) => {
      d("resolver.retry", { resolver: n, requirementId: l.id, attempt: g }),
        t("resolver.retry", { resolver: n, requirementId: l.id, attempt: g }),
        k("resolver.retry", { resolver: n, attempt: g });
    },
    onResolverCancel: (n, l) => {
      d("resolver.cancel", { resolver: n, requirementId: l.id }),
        t("resolver.cancel", { resolver: n, requirementId: l.id }),
        R.inflight.delete(n),
        k("resolver.cancel", { resolver: n });
    },
    onEffectRun: (n) => {
      d("effect.run", { id: n }),
        t("effect.run", { id: n }),
        O.effectRunCount++,
        k("effect.run", { id: n });
    },
    onEffectError: (n, l) => {
      d("effect.error", { id: n, error: String(l) }),
        O.effectErrorCount++,
        k("effect.error", { id: n, error: String(l) });
    },
    onSnapshot: (n) => {
      d("timetravel.snapshot", { id: n.id, trigger: n.trigger }),
        E && p.system && P(w),
        k("timetravel.snapshot", { id: n.id, trigger: n.trigger });
    },
    onTimeTravel: (n, l) => {
      if (
        (d("timetravel.jump", { from: n, to: l }),
        t("timetravel.jump", { from: n, to: l }),
        E && p.system)
      ) {
        const g = p.system;
        try {
          const x = g.facts.$store.toObject();
          T.clear(), E.refs.factsBody.replaceChildren();
          for (const [j, F] of Object.entries(x))
            Ee(T, E.refs.factsBody, j, F, !1);
          E.refs.factsCount.textContent = String(Object.keys(x).length);
        } catch {}
        A.clear(),
          D.derivationDeps.clear(),
          E.refs.derivBody.replaceChildren(),
          (K = null),
          P(v | I | C | f | w),
          k("timetravel.jump", { from: n, to: l });
      }
    },
    onError: (n) => {
      d("error", {
        source: n.source,
        sourceId: n.sourceId,
        message: n.message,
      }),
        t("error", { source: n.source, message: n.message }),
        k("error", { source: n.source, message: n.message });
    },
    onErrorRecovery: (n, l) => {
      d("error.recovery", {
        source: n.source,
        sourceId: n.sourceId,
        strategy: l,
      }),
        k("error.recovery", { source: n.source, strategy: l });
    },
  };
}
async function gr(e, r, a, i) {
  if ((await new Promise((o) => setTimeout(o, a)), Math.random() * 100 < i))
    throw new Error(`Server rejected ${e} for item ${r}`);
}
let yr = 6,
  Me = 1;
const Le = {
  facts: {
    items: ne.object(),
    syncQueue: ne.object(),
    syncingOpId: ne.string(),
    newItemText: ne.string(),
    serverDelay: ne.number(),
    failRate: ne.number(),
    toastMessage: ne.string(),
    toastType: ne.string(),
    eventLog: ne.object(),
  },
  derivations: {
    totalCount: ne.number(),
    doneCount: ne.number(),
    pendingCount: ne.number(),
    canAdd: ne.boolean(),
    isSyncing: ne.boolean(),
  },
  events: {
    toggleItem: { id: ne.string() },
    deleteItem: { id: ne.string() },
    addItem: {},
    setNewItemText: { value: ne.string() },
    setServerDelay: { value: ne.number() },
    setFailRate: { value: ne.number() },
    dismissToast: {},
  },
  requirements: { SYNC_TODO: { opId: ne.string() } },
};
function ue(e, r, a) {
  const i = [...e.eventLog];
  i.push({ timestamp: Date.now(), event: r, detail: a }),
    i.length > 100 && i.splice(0, i.length - 100),
    (e.eventLog = i);
}
const vr = It("optimistic-updates", {
    schema: Le,
    init: (e) => {
      (e.items = [
        { id: "1", text: "Buy groceries", done: !1 },
        { id: "2", text: "Learn Directive", done: !0 },
        { id: "3", text: "Walk the dog", done: !1 },
        { id: "4", text: "Read a book", done: !1 },
        { id: "5", text: "Fix the bug", done: !0 },
      ]),
        (e.syncQueue = []),
        (e.syncingOpId = ""),
        (e.newItemText = ""),
        (e.serverDelay = 800),
        (e.failRate = 30),
        (e.toastMessage = ""),
        (e.toastType = ""),
        (e.eventLog = []);
    },
    derive: {
      totalCount: (e) => e.items.length,
      doneCount: (e) => e.items.filter((r) => r.done).length,
      pendingCount: (e) => e.syncQueue.length,
      canAdd: (e) => e.newItemText.trim() !== "",
      isSyncing: (e) => e.syncingOpId !== "",
    },
    events: {
      toggleItem: (e, { id: r }) => {
        const a = e.items,
          i = a.map((c) => ({ ...c }));
        e.items = a.map((c) => (c.id === r ? { ...c, done: !c.done } : c));
        const o = String(Me++),
          s = [...e.syncQueue];
        s.push({ opId: o, itemId: r, op: "toggle", undoItems: i }),
          (e.syncQueue = s),
          ue(e, "optimistic", `Toggle item ${r}`);
      },
      deleteItem: (e, { id: r }) => {
        const a = e.items,
          i = a.map((c) => ({ ...c }));
        e.items = a.filter((c) => c.id !== r);
        const o = String(Me++),
          s = [...e.syncQueue];
        s.push({ opId: o, itemId: r, op: "delete", undoItems: i }),
          (e.syncQueue = s),
          ue(e, "optimistic", `Delete item ${r}`);
      },
      addItem: (e) => {
        const r = e.newItemText.trim();
        if (!r) return;
        const a = e.items,
          i = a.map((u) => ({ ...u })),
          o = String(yr++);
        (e.items = [...a, { id: o, text: r, done: !1 }]), (e.newItemText = "");
        const s = String(Me++),
          c = [...e.syncQueue];
        c.push({ opId: s, itemId: o, op: "add", undoItems: i }),
          (e.syncQueue = c),
          ue(e, "optimistic", `Add item "${r}"`);
      },
      setNewItemText: (e, { value: r }) => {
        e.newItemText = r;
      },
      setServerDelay: (e, { value: r }) => {
        e.serverDelay = r;
      },
      setFailRate: (e, { value: r }) => {
        e.failRate = r;
      },
      dismissToast: (e) => {
        (e.toastMessage = ""), (e.toastType = "");
      },
    },
    constraints: {
      needsSync: {
        priority: 100,
        when: (e) => {
          const r = e.syncQueue,
            a = e.syncingOpId;
          return r.length > 0 && a === "";
        },
        require: (e) => ({ type: "SYNC_TODO", opId: e.syncQueue[0].opId }),
      },
    },
    resolvers: {
      syncTodo: {
        requirement: "SYNC_TODO",
        key: (e) => `sync-${e.opId}`,
        timeout: 1e4,
        resolve: async (e, r) => {
          const i = r.facts.syncQueue.find((u) => u.opId === e.opId);
          if (!i) return;
          (r.facts.syncingOpId = e.opId),
            ue(r.facts, "syncing", `Syncing ${i.op} for item ${i.itemId}...`);
          const o = r.facts.serverDelay,
            s = r.facts.failRate;
          try {
            await gr(i.op, i.itemId, o, s),
              ue(r.facts, "success", `${i.op} item ${i.itemId} synced`),
              (r.facts.toastMessage = `${i.op} synced successfully`),
              (r.facts.toastType = "success");
          } catch {
            (r.facts.items = i.undoItems),
              ue(
                r.facts,
                "rollback",
                `Failed to ${i.op} item ${i.itemId} — rolled back`,
              ),
              (r.facts.toastMessage = `Failed to ${i.op} — rolled back`),
              (r.facts.toastType = "error");
          }
          const c = r.facts.syncQueue;
          (r.facts.syncQueue = c.filter((u) => u.opId !== e.opId)),
            (r.facts.syncingOpId = "");
        },
      },
    },
    effects: {
      logSyncChange: {
        deps: ["syncingOpId"],
        run: (e, r) => {
          if (r) {
            const a = r.syncingOpId,
              i = e.syncingOpId;
            a === "" && i !== ""
              ? ue(e, "status", `Sync started: op ${i}`)
              : a !== "" &&
                i === "" &&
                ue(e, "status", `Sync completed: op ${a}`);
          }
        },
      },
    },
  }),
  se = Kt({ module: vr, plugins: [hr({ name: "optimistic-updates" })] });
se.start();
const br = [...Object.keys(Le.facts), ...Object.keys(Le.derivations)],
  at = document.getElementById("ou-pending-count"),
  wr = document.getElementById("ou-pending-text"),
  Ie = document.getElementById("ou-add-input"),
  yt = document.getElementById("ou-add-btn"),
  Pe = document.getElementById("ou-todo-list"),
  Sr = document.getElementById("ou-todo-footer"),
  ct = document.getElementById("ou-toast"),
  xr = document.getElementById("ou-toast-text"),
  $r = document.getElementById("ou-toast-dismiss"),
  dt = document.getElementById("ou-server-delay"),
  Er = document.getElementById("ou-delay-val"),
  ut = document.getElementById("ou-fail-rate"),
  Cr = document.getElementById("ou-fail-val"),
  Te = document.getElementById("ou-timeline");
let ye = [],
  Se = null;
function vt() {
  const e = se.facts,
    r = se.derive,
    a = e.items,
    i = e.syncQueue,
    o = e.toastMessage,
    s = e.toastType,
    c = r.totalCount,
    u = r.doneCount,
    h = r.pendingCount,
    p = r.canAdd,
    d = e.eventLog,
    E = new Set(i.map((b) => b.itemId));
  h > 0
    ? (at.classList.add("visible"), (wr.textContent = `${h} syncing`))
    : at.classList.remove("visible"),
    (yt.disabled = !p);
  const T = new Map();
  for (const b of ye) T.set(b.id, b);
  const A = new Set(a.map((b) => b.id)),
    O = new Set();
  for (const b of a) {
    const R = T.get(b.id);
    R && R.done !== b.done && !E.has(b.id) && O.add(b.id);
  }
  for (const b of ye) A.has(b.id);
  const D = new Set(ye.map((b) => b.id));
  for (const b of a)
    !D.has(b.id) && ye.length > 0 && (E.has(b.id) || O.add(b.id));
  Pe.innerHTML = "";
  for (const b of a) {
    const R = E.has(b.id),
      z = document.createElement("div");
    (z.className = "ou-todo-item"),
      z.setAttribute("data-testid", `ou-item-${b.id}`),
      R && (z.classList.add("pending"), z.setAttribute("data-pending", "true")),
      b.done && z.classList.add("done"),
      O.has(b.id) &&
        (z.classList.add("ou-item-rollback"),
        setTimeout(() => z.classList.remove("ou-item-rollback"), 600)),
      (z.innerHTML = `
      <input
        type="checkbox"
        class="ou-todo-checkbox"
        data-testid="ou-toggle-${b.id}"
        data-action="toggle"
        data-id="${b.id}"
        ${b.done ? "checked" : ""}
        ${R ? "disabled" : ""}
      />
      <span class="ou-todo-text">${qe(b.text)}</span>
      <button
        class="ou-todo-delete"
        data-testid="ou-delete-${b.id}"
        data-action="delete"
        data-id="${b.id}"
        ${R ? "disabled" : ""}
      >🗑</button>
    `),
      Pe.appendChild(z);
  }
  if (
    ((ye = a.map((b) => ({ ...b }))),
    (Sr.textContent = `${c} todo${c !== 1 ? "s" : ""} · ${u} done · ${h} pending`),
    o
      ? ((ct.className = `ou-toast visible ${s}`),
        (xr.textContent = o),
        Se && clearTimeout(Se),
        (Se = setTimeout(() => {
          se.events.dismissToast(), (Se = null);
        }, 3e3)))
      : (ct.className = "ou-toast"),
    (Er.textContent = `${e.serverDelay}ms`),
    (Cr.textContent = `${e.failRate}%`),
    d.length === 0)
  )
    Te.innerHTML =
      '<div class="ou-timeline-empty">Events will appear here after actions</div>';
  else {
    Te.innerHTML = "";
    for (let b = d.length - 1; b >= 0; b--) {
      const R = d[b],
        z = document.createElement("div");
      z.className = `ou-timeline-entry ${R.event}`;
      const m = new Date(R.timestamp).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
      (z.innerHTML = `
        <span class="ou-timeline-time">${m}</span>
        <span class="ou-timeline-event">${qe(R.event)}</span>
        <span class="ou-timeline-detail">${qe(R.detail)}</span>
      `),
        Te.appendChild(z);
    }
  }
}
se.subscribe(br, vt);
Ie.addEventListener("input", () => {
  se.events.setNewItemText({ value: Ie.value });
});
Ie.addEventListener("keydown", (e) => {
  e.key === "Enter" && (e.preventDefault(), bt());
});
function bt() {
  se.facts.newItemText.trim() && (se.events.addItem(), (Ie.value = ""));
}
yt.addEventListener("click", bt);
Pe.addEventListener("click", (e) => {
  const r = e.target,
    a = r.dataset.id;
  a &&
    (r.dataset.action === "toggle" &&
      (e.preventDefault(), se.events.toggleItem({ id: a })),
    r.dataset.action === "delete" && se.events.deleteItem({ id: a }));
});
$r.addEventListener("click", () => {
  se.events.dismissToast();
});
dt.addEventListener("input", () => {
  se.events.setServerDelay({ value: Number(dt.value) });
});
ut.addEventListener("input", () => {
  se.events.setFailRate({ value: Number(ut.value) });
});
function qe(e) {
  const r = document.createElement("div");
  return (r.textContent = e), r.innerHTML;
}
vt();
document.body.setAttribute("data-optimistic-updates-ready", "true");
